import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  data: Buffer;
}

function decodePng(file: string): PngInfo {
  const buf = readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let idat: Buffer[] = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    data: inflateSync(Buffer.concat(idat)),
  };
}

function analyze(file: string): void {
  const png = decodePng(file);
  const { width, height, colorType, data } = png;
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const bpp = channels * (png.bitDepth / 8);
  const stride = width * bpp;

  // Undo PNG filters (simplified: re-do per scanline).
  const raw = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[p++];
    const line = Buffer.from(data.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      }
      line[x] = v;
    }
    line.copy(raw, y * stride);
    prev = line;
  }

  let opaque = 0;
  let semiTransparent = 0;
  let transparent = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const samples: string[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * stride + x * bpp);
      const alpha = channels === 4 ? raw[i + 3] : 255;
      if (alpha === 0) transparent++;
      else if (alpha < 255) semiTransparent++;
      else {
        opaque++;
        sumR += raw[i];
        sumG += raw[i + 1];
        sumB += raw[i + 2];
        if (samples.length < 5 && (x % 50 === 0) && (y % 50 === 0)) {
          samples.push(`(${x},${y}) rgba=${raw[i]},${raw[i + 1]},${raw[i + 2]},${alpha}`);
        }
      }
    }
  }

  const total = width * height;
  console.log(`\n=== ${file} ===`);
  console.log(`tamaño: ${width}x${height}, colorType=${colorType}, channels=${channels}`);
  console.log(
    `opaco: ${((opaque / total) * 100).toFixed(2)}%, semi: ${((semiTransparent / total) * 100).toFixed(2)}%, transparente: ${((transparent / total) * 100).toFixed(2)}%`,
  );
  if (opaque > 0) {
    console.log(
      `promedio RGB de píxeles opacos: ${Math.round(sumR / opaque)}, ${Math.round(sumG / opaque)}, ${Math.round(sumB / opaque)}`,
    );
  }
  console.log("muestras:", samples.join(" "));
}

for (const file of process.argv.slice(2)) {
  analyze(file);
}
