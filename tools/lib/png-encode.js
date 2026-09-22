"use strict";
/* Minimal PNG encoder (8-bit RGBA, filter 0) — for flag crops and the images
   handed to OCR. */
const zlib = require("zlib");

let TBL = null;
function crcTable() {
  if (TBL) return TBL;
  TBL = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    TBL[n] = c;
  }
  return TBL;
}
function crc32(buf) {
  const t = crcTable();
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG({ width, height, data }) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                       /* "None" filter */
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* Crop and box-average resample. Flags are flat colour, so averaging is both
   sufficient and sharp. */
function cropScale(img, box, outW, outH) {
  const { width: W, data: S } = img;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sx = box.w / outW, sy = box.h / outH;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const x0 = box.x + Math.floor(x * sx), x1 = box.x + Math.max(Math.ceil((x + 1) * sx), Math.floor(x * sx) + 1);
      const y0 = box.y + Math.floor(y * sy), y1 = box.y + Math.max(Math.ceil((y + 1) * sy), Math.floor(y * sy) + 1);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 4;
        r += S[i]; g += S[i + 1]; b += S[i + 2]; a += S[i + 3]; n++;
      }
      const o = (y * outW + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: outW, height: outH, data: out };
}

module.exports = { encodePNG, cropScale };
