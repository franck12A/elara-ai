// Analiza un PNG sin dependencias: dimensiones + histograma de colores.
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const file = process.argv[2];
const buf = readFileSync(file);

let offset = 8;
let width = 0;
let height = 0;
let bitDepth = 0;
let colorType = 0;
const idatChunks: Buffer[] = [];

while (offset < buf.length) {
  const len = buf.readUInt32BE(offset);
  const type = buf.toString("ascii", offset + 4, offset + 8);
  const data = buf.subarray(offset + 8, offset + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
  } else if (type === "IDAT") {
    idatChunks.push(data);
  }
  offset += 12 + len;
}

console.log(`PNG: ${width}x${height} bitDepth=${bitDepth} colorType=${colorType}`);

const raw = zlib.inflateSync(Buffer.concat(idatChunks));
// colorType 2 = RGB, 6 = RGBA (asume 8 bits)
const bpp = colorType === 6 ? 4 : 3;
const stride = width * bpp;
const pixels: number[] = new Array(width * height * bpp);

let pos = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[pos++];
  const row = raw.subarray(pos, pos + stride);
  pos += stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? pixels[(y - 1) * stride + x] : 0; // arriba (uso mismo buffer fila anterior)
    const left = x >= bpp ? pixels[y * stride + x - bpp] : 0;
    const upLeft = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;
    const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
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
    pixels[y * stride + x] = val & 0xff;
  }
}

// Histograma de colores (muestreo cada 16 px para velocidad)
const hist = new Map<string, number>();
let total = 0;
for (let i = 0; i < pixels.length; i += bpp * 16) {
  const r = pixels[i];
  const g = pixels[i + 1];
  const b = pixels[i + 2];
  const al = bpp === 4 ? pixels[i + 3] : 255;
  const key = al < 10 ? "transparent" : `${r >> 4},${g >> 4},${b >> 4}`;
  hist.set(key, (hist.get(key) ?? 0) + 1);
  total++;
}

const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("Top colores (muestreados):");
for (const [k, v] of sorted) {
  console.log(`  ${k}: ${((v / total) * 100).toFixed(1)}%`);
}
