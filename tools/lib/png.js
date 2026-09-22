"use strict";
/* Minimal PNG decoder: 8-bit, RGB/RGBA, non-interlaced — which is what
   screenshots produce. Enough here, with nothing to install. */
const zlib = require("zlib");

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG: bad signature");
  let off = 8, idat = [], ihdr = null, palette = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4),
               depth: data[8], colorType: data[9], interlace: data[12] };
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error("missing IHDR chunk");
  if (ihdr.depth !== 8) throw new Error(ihdr.depth + "-bit depth is not supported");
  if (ihdr.interlace) throw new Error("interlaced PNG is not supported");

  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
  if (!CH) throw new Error("unsupported colour type " + ihdr.colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width: W, height: H } = ihdr;
  const stride = W * CH;
  const out = Buffer.alloc(stride * H);

  /* per-scanline unfiltering (RFC 2083) */
  let p = 0;
  for (let y = 0; y < H; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= CH ? cur[i - CH] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= CH ? prev[i - CH] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }

  /* normalise to RGBA */
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0, n = W * H; i < n; i++) {
    let r, g, b, a = 255;
    if (ihdr.colorType === 6) { r = out[i*4]; g = out[i*4+1]; b = out[i*4+2]; a = out[i*4+3]; }
    else if (ihdr.colorType === 2) { r = out[i*3]; g = out[i*3+1]; b = out[i*3+2]; }
    else if (ihdr.colorType === 0) { r = g = b = out[i]; }
    else if (ihdr.colorType === 4) { r = g = b = out[i*2]; a = out[i*2+1]; }
    else { const k = out[i]; r = palette[k*3]; g = palette[k*3+1]; b = palette[k*3+2];
           if (trns && k < trns.length) a = trns[k]; }
    rgba[i*4] = r; rgba[i*4+1] = g; rgba[i*4+2] = b; rgba[i*4+3] = a;
  }
  return { width: W, height: H, data: rgba };
}

module.exports = { decodePNG };
