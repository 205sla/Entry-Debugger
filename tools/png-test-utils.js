'use strict';
const assert = require('assert');
const zlib = require('zlib');

// Independent PNG decoder for Chromium's 8-bit RGB/RGBA output. Validate CRCs,
// inflate IDAT and reverse every PNG filter; never use browser canvas to test itself.
function decodePng(bytes) {
  assert.strictEqual(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const parts = [];
  let width, height, channels;
  let ended = false;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    assert.strictEqual((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(offset + 8 + length), type + ' CRC');
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.strictEqual(data[8], 8); assert([2, 6].includes(data[9]));
      assert.strictEqual(data[12], 0);
      channels = data[9] === 6 ? 4 : 3;
    }
    if (type === 'IDAT') parts.push(data);
    if (type === 'IEND') ended = true;
    offset += length + 12;
    assert(offset <= bytes.length);
  }
  assert(ended && width > 0 && height > 0);
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  assert.strictEqual(raw.length, (stride + 1) * height);
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const a = x >= channels ? pixels[index - channels] : 0;
      const b = y ? pixels[index - stride] : 0;
      const c = y && x >= channels ? pixels[index - stride - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[index] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return { width, height, pixels, pixel(x, y) {
    const start = (Math.floor(y) * width + Math.floor(x)) * channels;
    return [...pixels.subarray(start, start + 3), channels === 4 ? pixels[start + 3] : 255];
  } };
}
module.exports = { decodePng };
