"""Prototipo de lip-sync 2D para elara.png + voice.wav.

ADVERTENCIA: esto es una deformacion 2D basica, no un modelo de difusion.
No va a verse fotorrealista. El objetivo es ver si la sincronia y el
movimiento son creibles, nada mas.

Pipeline:
  1. Analiza el audio (RMS + bandas espectrales) -> visemas por frame
  2. Programa parpadeos con intervalos irregulares
  3. Deforma la imagen: cabeza, cejas, boca
  4. Sintetiza la cavidad oral (interior oscuro) al abrir la boca
  5. Escribe los frames a disco para que ffmpeg los ensamble
"""
import json
import os
import wave
import numpy as np
import cv2
from PIL import Image

FPS = 25
FRAMES_DIR = "frames"
OUT_SIZE = None  # se mantiene el tamaño original

# --------------------------------------------------------------------------
# 1. Analisis del audio
# --------------------------------------------------------------------------


def read_wav(path):
    with wave.open(path, "rb") as wf:
        n = wf.getnframes()
        sr = wf.getframerate()
        ch = wf.getnchannels()
        raw = wf.readframes(n)
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    return data, sr


def analyze_audio(path, fps):
    """Devuelve por frame: rms, y clasificacion de visema (ancho/alto/radio)."""
    data, sr = read_wav(path)
    hop = sr / fps
    win = int(sr * 0.045)

    frames = int(np.ceil(len(data) / hop))
    rms_list = []
    centroid_list = []

    for i in range(frames):
        start = int(i * hop)
        seg = data[start:start + win]
        if len(seg) < 8:
            rms_list.append(0.0)
            centroid_list.append(0.0)
            continue

        rms = float(np.sqrt(np.mean(seg ** 2)))
        rms_list.append(rms)

        # Centroide espectral: energia alta = consonantes / fonemas "i"
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
        freqs = np.fft.rfftfreq(len(seg), 1.0 / sr)
        total = spec.sum()
        centroid = float((spec * freqs).sum() / total) if total > 1e-9 else 0.0
        centroid_list.append(centroid)

    rms = np.array(rms_list)
    centroid = np.array(centroid_list)

    # Normalizacion por percentil para que la voz sea consistente
    p95 = np.percentile(rms, 95) if rms.max() > 1e-9 else 1.0
    rms_n = np.clip(rms / max(p95, 1e-6), 0.0, 1.0)

    # Umbral de silencio: evita que la boca se abra en los silencios
    speech = rms_n > 0.06
    rms_n = rms_n * speech

    # Suavizado: una apertura de boca no tiene bordes tan duros
    kernel = np.array([0.25, 0.5, 0.25])
    rms_smooth = np.convolve(rms_n, kernel, mode="same")

    return rms_n, rms_smooth, centroid, speech


def viseme_params(openness, centroid, speech):
    """Traduce (apertura, centroide) a parametros de forma de boca.

    Fonemas con energia alta ('i', 'e') estiran la boca a lo ancho.
    Fonemas graves ('o', 'u') la redondean.
    """
    if not speech or openness < 0.05:
        return 0.0, 1.0  # cerrada, ancho neutro

    # Apertura real: raiz cuadrada para que los sonidos suaves no se
    # cierren del todo y los fuertes no revienten.
    height = float(np.sqrt(openness))

    # Centroide normalizado respecto al percentil del audio
    c_norm = np.clip((centroid - 500.0) / 2500.0, 0.0, 1.0)

    # 'o' y 'u': graves -> mas redondas y estrechas
    roundness = 1.0 - c_norm
    width = 1.0 + 0.22 * c_norm - 0.28 * roundness * 0.5

    return height, float(width)


# --------------------------------------------------------------------------
# 2. Parpadeos
# --------------------------------------------------------------------------


def blink_schedule(total_frames, rng):
    """Parpadeos con intervalos irregulares, como los humanos."""
    blinks = []
    t = rng.integers(8, 40)
    while t < total_frames:
        blinks.append(int(t))
        # Intervalo variable: la mayoria 2.5-5s, algunos muy cortos
        gap = rng.normal(70, 22)
        gap = int(np.clip(gap, 22, 130))
        t += gap
        # Ocasionalmente un parpadeo doble
        if rng.random() < 0.18:
            t += rng.integers(8, 14)
    return blinks


def blink_amount(frame, blinks, dur=6):
    """0 = ojo abierto, 1 = cerrado. Curva suave dentro del parpadeo."""
    for b in blinks:
        if b <= frame <= b + dur:
            p = (frame - b) / dur
            # cierra rapido, abre un poco mas lento
            if p < 0.4:
                return float(np.sin((p / 0.4) * np.pi / 2))
            return float(np.cos(((p - 0.4) / 0.6) * np.pi / 2))
    return 0.0


# --------------------------------------------------------------------------
# 3. Micro-movimiento de cabeza
# --------------------------------------------------------------------------


def head_motion(t, rng_state):
    """Senales suaves y no periodicas para inclinacion/rotacion."""
    # Suma de senos con periodos incomensurables: nunca se repite exact0
    sway = (np.sin(t * 0.9 + 1.3) * 0.6 + np.sin(t * 0.37 + 4.1) * 0.4)
    nod = np.sin(t * 0.53 + 2.2) * 0.5 + np.sin(t * 1.21 + 0.4) * 0.25
    return sway, nod


def breathing(t, speech):
    """Respiracion: ciclo lento, mas marcado en las pausas."""
    rate = 0.22
    breath = np.sin(t * rate * 2 * np.pi) * 0.5 + 0.5
    return breath


# --------------------------------------------------------------------------
# 4. Deformacion de la imagen
# --------------------------------------------------------------------------


def warp_around_point(img, cx, cy, amount_y, amount_x, radius, feather=0.35):
    """Desplaza verticalmente (y opcionalmente en x) los pixeles alrededor
    de un punto, con desvanecido hacia los bordes para evitar cortes.

    amount_y > 0  -> abre hacia abajo (mandibula)
    amount_y < 0  -> comprime hacia arriba
    """
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    d = np.sqrt(((xx - cx) / radius) ** 2 + ((yy - cy) / radius) ** 2)
    # 0 en el centro, 1 en el borde; feather controla la suavidad
    t = np.clip(1.0 - d, 0.0, 1.0)
    t = t ** (1.0 / max(feather, 0.01))

    # OpenCV 5 requiere los mapas de remapeo en float32.
    src_x = (xx - amount_x * t).astype(np.float32)
    src_y = (yy - amount_y * t).astype(np.float32)

    return cv2.remap(
        img,
        src_x,
        src_y,
        interpolation=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def apply_head_transform(img, sway, nod, cx, cy):
    """Rotacion + desplazamiento muy leve de toda la imagen."""
    h, w = img.shape[:2]
    angle = sway * 0.9  # grados, muy sutil
    scale = 1.0 + nod * 0.004

    M = cv2.getRotationMatrix2D((cx, cy), angle, scale)
    M[0, 2] += sway * 2.5
    M[1, 2] += nod * 2.0
    return cv2.warpAffine(
        img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


def draw_mouth_interior(img, mouth, openness, width):
    """Pinta la cavidad oral oscura cuando la boca se abre.

    Sin esto, solo estirar los labios da un resultado plano y falso.
    """
    if openness < 0.12:
        return img

    outer = np.array(mouth["outer_pts"], dtype=np.float32)
    inner = np.array(mouth["inner_pts"], dtype=np.float32)

    cx = mouth["cx"]
    cy = mouth["cy"]
    mw = mouth["w"]
    mh = mouth["h"]

    # Los landmarks traen (x, y, z); para dibujar solo hace falta x, y.
    inner = inner[:, :2].astype(np.float32)

    # Escala el contorno interior segun la apertura
    sx = width
    sy = 1.0 + openness * 1.15
    inner_scaled = inner.copy()
    inner_scaled[:, 0] = cx + (inner[:, 0] - cx) * sx
    inner_scaled[:, 1] = cy + (inner[:, 1] - cy) * sy

    h, w = img.shape[:2]
    mask = np.zeros((h, w), dtype=np.float32)
    # OpenCV espera un vector de puntos (N,2) de enteros.
    poly = np.round(inner_scaled).astype(np.int32).reshape(-1, 2)
    cv2.fillConvexPoly(mask, poly, 1.0, lineType=cv2.LINE_AA)

    if mask.sum() < 1:
        return img

    # Color de la cavidad: oscuro, con tono rojo/rojizo
    cavity = np.array([48, 32, 38], dtype=np.float32)

    # Degradado vertical: mas oscuro arriba, algo mas claro abajo (lengua)
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    top = np.array([38, 22, 28], dtype=np.float32)
    bottom = np.array([92, 52, 56], dtype=np.float32)
    grad = top[None, None, :] * (1 - yy[:, :, None]) + bottom[None, None, :] * yy[:, :, None]
    grad = np.repeat(grad, w, axis=1)

    mask3 = mask[:, :, None]
    # Las esquinas se suavizan para que no se vea un poligono duro
    alpha = cv2.GaussianBlur(mask3, (0, 0), sigmaX=2.0, sigmaY=2.0)
    alpha = alpha.reshape(h, w, 1) * 0.92
    alpha = np.clip(alpha, 0.0, 1.0)

    out = img * (1 - alpha) + grad * alpha

    # Dientes: solo cuando la boca esta bien abierta
    if openness > 0.34:
        teeth_h = mh * 0.16 * (1.0 - (openness - 0.34) / 0.9)
        top_y = inner_scaled[:, 1].min()
        teeth_band = np.zeros((h, w), dtype=np.float32)
        y0 = int(max(0, top_y + mh * 0.02))
        y1 = int(min(h, y0 + max(2, teeth_h)))
        teeth_band[y0:y1, :] = 1.0

        # Limitar a la zona interior de la boca
        teeth_mask = teeth_band * mask
        teeth_mask = cv2.GaussianBlur(teeth_mask, (0, 0), sigmaX=1.2, sigmaY=1.2)
        teeth_mask = teeth_mask.reshape(h, w, 1) * 0.88
        teeth_color = np.array([214, 208, 200], dtype=np.float32)
        out = out * (1 - teeth_mask) + teeth_color[None, None, :] * teeth_mask

    return np.clip(out, 0, 255)


def blink_eyes(img, left_eye, right_eye, amount, eye_idx_lists):
    """Cierra los ojos bajando el parpado superior.

    Se deforma la region de cada ojo comprimiendo verticalmente hacia
    el centro, lo que simula el parpadeo sin dibujar nada artificial.
    """
    if amount < 0.02:
        return img

    out = img
    for eye in (left_eye, right_eye):
        cx = eye["cx"]
        cy = eye["cy"]
        radius = max(face_eye_radius, 1.0)
        # Al cerrar, el ojo se aplasta: comprimimos hacia su centro
        squeeze = amount * radius * 0.42
        out = warp_around_point(
            out, cx, cy, -squeeze, 0.0, radius, feather=0.5
        )
    return out


# --------------------------------------------------------------------------
# 5. Bucle principal
# --------------------------------------------------------------------------


def main():
    rng = np.random.default_rng(7)

    with open("face_landmarks.json") as f:
        face = json.load(f)

    img = Image.open("elara.png").convert("RGB")
    base = np.array(img).astype(np.float32)
    h, w = base.shape[:2]

    mouth = face["mouth"]
    left_eye = face["left_eye"]
    right_eye = face["right_eye"]
    eye_dist = face["eye_dist"]
    face_cx = (left_eye["cx"] + right_eye["cx"]) / 2
    face_cy = (left_eye["cy"] + right_eye["cy"]) / 2

    global face_eye_radius
    face_eye_radius = eye_dist * 0.22

    rms, rms_smooth, centroid, speech = analyze_audio("voice.wav", FPS)
    total = len(rms)
    blinks = blink_schedule(total, rng)

    os.makedirs(FRAMES_DIR, exist_ok=True)
    for old in os.listdir(FRAMES_DIR):
        os.remove(os.path.join(FRAMES_DIR, old))

    print(f"frames: {total}  blinks: {len(blinks)}  dur: {total/FPS:.2f}s")

    for i in range(total):
        t = i / FPS

        height, width = viseme_params(
            rms_smooth[i], centroid[i], speech[i]
        )

        sway, nod = head_motion(t, None)
        breath = breathing(t, speech[i])

        frame = base.copy()

        # --- cabeza: transformacion global sutil
        frame = apply_head_transform(frame, sway, nod, face_cx, face_cy)

        # --- respiracion: desplazamiento minimo del cuello/hombros
        if breath > 0:
            frame = warp_around_point(
                frame,
                face_cx,
                face_cy + (h - face_cy) * 0.4,
                breath * 1.4,
                0.0,
                (h - face_cy) * 0.9,
                feather=0.6,
            )

        # --- cejas: suben levemente con la entonacion
        brow_lift = 0.35 + 0.65 * rms_smooth[i]
        brow_px = (1.0 + 0.9 * brow_lift) * 2.2
        frame = warp_around_point(
            frame,
            left_eye["cx"],
            left_eye["cy"] - eye_dist * 0.30,
            -brow_px * 0.4,
            0.0,
            eye_dist * 0.26,
            feather=0.7,
        )
        frame = warp_around_point(
            frame,
            right_eye["cx"],
            right_eye["cy"] - eye_dist * 0.30,
            -brow_px * 0.4,
            0.0,
            eye_dist * 0.26,
            feather=0.7,
        )

        # --- parpadeo
        b = blink_amount(i, blinks)
        frame = blink_eyes(frame, left_eye, right_eye, b, None)

        # --- mandibula / boca
        if height > 0.02:
            jaw_drop = mouth["h"] * 1.55 * height
            frame = warp_around_point(
                frame,
                mouth["cx"],
                mouth["cy"] - mouth["h"] * 0.25,
                jaw_drop * 0.55,
                0.0,
                max(mouth["w"] * 0.62, 4.0),
                feather=0.45,
            )
            # commissuras: abrir hacia los lados
            frame = warp_around_point(
                frame,
                mouth["cx"],
                mouth["cy"],
                0.0,
                (width - 1.0) * mouth["w"] * 0.30,
                max(mouth["w"] * 0.55, 4.0),
                feather=0.5,
            )

        # --- cavidad oral
        frame = draw_mouth_interior(frame, mouth, height, width)

        out = np.clip(frame, 0, 255).astype(np.uint8)
        cv2.imwrite(
            os.path.join(FRAMES_DIR, f"{i:05d}.png"),
            cv2.cvtColor(out, cv2.COLOR_RGB2BGR),
        )

        if i % 25 == 0:
            print(f"  frame {i}/{total}")

    print("frames listos en", FRAMES_DIR)


if __name__ == "__main__":
    main()
