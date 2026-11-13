'use strict';

/**
 * Dependency-free icon generator.
 *
 * Produces assets/icon.png (256x256 RGBA) so the repository does not need to
 * ship a binary that cannot be regenerated. Run `npm run icon` after editing.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 256;
const pixels = new Uint8Array(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const index = (y * SIZE + x) * 4;
  const alpha = a / 255;
  pixels[index] = Math.round(pixels[index] * (1 - alpha) + r * alpha);
  pixels[index + 1] = Math.round(pixels[index + 1] * (1 - alpha) + g * alpha);
  pixels[index + 2] = Math.round(pixels[index + 2] * (1 - alpha) + b * alpha);
  pixels[index + 3] = Math.min(255, Math.round(pixels[index + 3] * (1 - alpha) + a));
}

function insideRoundedRect(x, y, box, radius) {
  const { left, top, width, height } = box;
  const right = left + width - 1;
  const bottom = top + height - 1;
  if (x < left || x > right || y < top || y > bottom) return false;

  const cornerX = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cornerY = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const dx = x - cornerX;
  const dy = y - cornerY;
  return dx * dx + dy * dy <= radius * radius;
}

function fillRoundedRect(box, radius, colorAt) {
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      if (!insideRoundedRect(x, y, box, radius)) continue;
      const color = colorAt(x, y);
      if (color) setPixel(x, y, ...color);
    }
  }
}

// Rounded-square gradient background.
const background = { left: 18, top: 18, width: 220, height: 220 };
fillRoundedRect(background, 56, (x, y) => {
  const t = (x + y) / (SIZE * 2);
  const r = Math.round(99 + (167 - 99) * t);
  const g = Math.round(230 + (139 - 230) * t);
  const b = Math.round(255 + (250 - 255) * t);
  return [r, g, b, 255];
});

// Inner highlight ring.
for (let angle = 0; angle < Math.PI * 2; angle += 0.002) {
  const cx = 128 + Math.cos(angle) * 100;
  const cy = 128 + Math.sin(angle) * 100;
  setPixel(Math.round(cx), Math.round(cy), 255, 255, 255, 40);
}

// Monogram "T".
fillRoundedRect({ left: 62, top: 78, width: 132, height: 26 }, 13, () => [9, 16, 27, 255]);
fillRoundedRect({ left: 112, top: 78, width: 32, height: 108 }, 14, () => [9, 16, 27, 255]);

// Accent node, suggesting a metered endpoint.
for (let y = -11; y <= 11; y += 1) {
  for (let x = -11; x <= 11; x += 1) {
    if (x * x + y * y <= 121) setPixel(190 + x, 66 + y, 9, 16, 27, 255);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(pixels.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const output = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, png);
console.log(`icon written: ${output} (${png.length} bytes)`);
