"""Verifica que la apertura de boca siga al audio (diagnostico, no salida final)."""
import wave
import numpy as np
import cv2
import sys

sys.path.insert(0, "scripts")
from animate_face import analyze_audio, FPS, blink_amount  # noqa: E402

rms, rms_smooth, centroid, speech = analyze_audio("voice.wav", FPS)

# Medimos cuanta apertura de boca hay realmente en cada frame, mirando
# solo la region de la boca (deformacion real, no la senal sintetica).
import json
with open("face_landmarks.json") as f:
    face = json.load(f)
m = face["mouth"]
x0 = int(m["cx"] - m["w"] * 0.9)
x1 = int(m["cx"] + m["w"] * 0.9)
y0 = int(m["cy"] - m["h"] * 1.6)
y1 = int(m["cy"] + m["h"] * 2.2)

ref = cv2.imread("frames/00000.png", cv2.IMREAD_GRAYSCALE).astype(np.float32)
ref_crop = ref[y0:y1, x0:x1]

measured = []
for i in range(len(rms)):
    p = f"frames/{i:05d}.png"
    img = cv2.imread(p, cv2.IMREAD_GRAYSCALE).astype(np.float32)
    crop = img[y0:y1, x0:x1]
    measured.append(float(np.abs(crop - ref_crop).mean()))

measured = np.array(measured)

# Correlacion de Pearson entre audio y movimiento medido
if measured.std() > 1e-6 and rms_smooth.std() > 1e-6:
    corr = float(np.corrcoef(rms_smooth, measured)[0, 1])
else:
    corr = 0.0

print("frames analizados:", len(measured))
print("movimiento medio en la region de la boca: %.3f" % measured.mean())
print("movimiento maximo: %.3f" % measured.max())
print("correlacion audio<->boca: %.3f" % corr)

# La boca deberia estar casi quieta durante los silencios
sil = ~speech
if sil.sum() > 0:
    print("frames en silencio: %d | movimiento medio en silencio: %.3f"
          % (sil.sum(), measured[sil].mean()))
if speech.sum() > 0:
    print("frames con voz: %d | movimiento medio con voz: %.3f"
          % (speech.sum(), measured[speech].mean()))
