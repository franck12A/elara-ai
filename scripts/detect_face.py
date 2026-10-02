"""Detecta los landmarks faciales de elara.png con la API Tasks de mediapipe."""
import json
import mediapipe as mp
import numpy as np
from PIL import Image
import os

MODEL = os.path.join("models", "face_landmarker.task")

img = Image.open("elara.png").convert("RGB")
w, h = img.size
print("imagen:", w, "x", h)

base_options = mp.tasks.BaseOptions(model_asset_path=MODEL)
options = mp.tasks.vision.FaceLandmarkerOptions(
    base_options=base_options,
    output_face_blendshapes=False,
    num_faces=1,
)

with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker:
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.array(img))
    res = landmarker.detect(mp_image)

if not res.face_landmarks:
    raise SystemExit("NO SE DETECTO UNA CARA. Revisar la imagen.")

lm = res.face_landmarks[0]
pts = np.array([[p.x * w, p.y * h, p.z * w] for p in lm])

MOUTH_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]
MOUTH_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]
LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [263, 362, 385, 387, 386, 374]

mouth_outer = pts[MOUTH_OUTER]
mouth_inner = pts[MOUTH_INNER]
le = pts[LEFT_EYE]
re = pts[RIGHT_EYE]

mouth_cx = float(mouth_outer[:, 0].mean())
mouth_cy = float(mouth_outer[:, 1].mean())
mouth_w = float(mouth_outer[:, 0].max() - mouth_outer[:, 0].min())
mouth_h = float(mouth_outer[:, 1].max() - mouth_outer[:, 1].min())

le_c = le[:, :2].mean(axis=0)
re_c = re[:, :2].mean(axis=0)
eye_dist = float(np.linalg.norm(le_c - re_c))

info = {
    "width": w,
    "height": h,
    "mouth": {
        "cx": mouth_cx, "cy": mouth_cy, "w": mouth_w, "h": mouth_h,
        "outer_idx": MOUTH_OUTER,
        "inner_idx": MOUTH_INNER,
        "outer_pts": mouth_outer.tolist(),
        "inner_pts": mouth_inner.tolist(),
    },
    "left_eye": {"cx": float(le_c[0]), "cy": float(le_c[1]), "idx": LEFT_EYE},
    "right_eye": {"cx": float(re_c[0]), "cy": float(re_c[1]), "idx": RIGHT_EYE},
    "eye_dist": eye_dist,
    "chin_y": float(pts[152][1]),
    "forehead_y": float(pts[10][1]),
    "nose_tip": pts[1].tolist(),
}

with open("face_landmarks.json", "w") as f:
    json.dump(info, f, indent=2)

print("boca centro: (%.1f, %.1f)  ancho=%.1f alto=%.1f" % (mouth_cx, mouth_cy, mouth_w, mouth_h))
print("ojo izq: (%.1f, %.1f)" % (le_c[0], le_c[1]))
print("ojo der: (%.1f, %.1f)" % (re_c[0], re_c[1]))
print("distancia entre ojos: %.1f" % eye_dist)
print("barbilla y=%.1f  frente y=%.1f" % (info["chin_y"], info["forehead_y"]))
print("-> face_landmarks.json escrito")
