// Analiza una región de un PNG: reporta % de píxeles que difieren del fondo.
// Uso: npx tsx scripts/png-crop.ts archivo.png x y w h
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const [file, sx, sy, sw, sh] = [
  process.argv[2],
  Number(process.argv[3]),
  Number(process.argv[4]),
  Number(process.argv[5]),
  Number(process.argv[6]),
];
const buf = readFileSync(file);
let offset = 8;
let width = 0;
let height = 0;
let colorType = 0;
const idat: Buffer[] = [];
while (offset < buf.length) {
  const len = buf.readUInt32BE(offset);
  const type = buf.toString("ascii", offset + 4, offset + 8);
  const data = buf.subarray(offset + 8, offset + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    colorType = data[9];
  } else if (type === "IDAT") idat.push(data);
  offset += 12 + len;
}
const bpp = colorType === 6 ? 4 : 3;
const stride = width * bpp;
const raw = zlib.inflateSync(Buffer.concat(idat));
const px: number[] = new Array(width * height * bpp);
let pos = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[pos++];
  const row = raw.subarray(pos, pos + stride);
  pos += stride;
  for (let x = 0; x < stride; x++) {
    const left = x >= bpp ? px[y * stride + x - bpp] : 0;
    const up = y > 0 ? px[(y - 1) * stride + x] : 0;
    const upLeft = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
    const v = row[x];
    let val: number;
    switch (filter) {
      case 0: val = v; break;
      case 1: val = v + left; break;
      case 2: val = v + up; break;
      case 3: val = v + Math.floor((left + up) / 2); break;
      case 4: {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        val = v + pr;
        break;
      }
      default: val = v;
    }
    px[y * stride + x] = val & 0xff;
  }
}

// Fondo esperado: gradiente entre #1c1b2e (arriba) y #0d0d12 (abajo)
let distintos = 0;
let total = 0;
let maxDiff = 0;
let sumR = 0, sumG = 0, sumB = 0;
for (let y = sy; y < sy + sh && y < height; y++) {
  for (let x = sx; x < sx + sw && x < width; x++) {
    const i = (y * stride + x * bpp);
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const t = y / height;
    const fr = 0x1c + (0x0d - 0x1c) * t;
    const fg = 0x1b + (0x0d - 0x1b) * t;
    const fb = 0x2e + (0x12 - 0x2e) * t;
    const diff = Math.abs(r - fr) + Math.abs(g - fg) + Math.abs(b - fb);
    if (diff > 30) distintos++;
    if (diff > maxDiff) maxDiff = diff;
    sumR += r; sumG += g; sumB += b;
    total++;
  }
}
console.log(`Región ${sw}x${sh} en (${sx},${sy}) de ${width}x${height}`);
console.log(`Píxeles distintos del fondo: ${((distintos / total) * 100).toFixed(1)}% (maxDiff=${maxDiff})`);
console.log(`Color promedio: rgb(${Math.round(sumR / total)},${Math.round(sumG / total)},${Math.round(sumB / total)})`);

// Brillo: % de píxeles claros (suma RGB > 300) y muy claros (> 500)
let bright = 0;
let veryBright = 0;
for (let y = sy; y < sy + sh && y < height; y++) {
  for (let x = sx; x < sx + sw && x < width; x++) {
    const i = y * stride + x * bpp;
    const s = px[i] + px[i + 1] + px[i + 2];
    if (s > 300) bright++;
    if (s > 500) veryBright++;
  }
}
console.log(`Píxeles claros (>300): ${((bright / total) * 100).toFixed(2)}% | muy claros (>500): ${((veryBright / total) * 100).toFixed(2)}%`);
