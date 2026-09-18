// Dependency-free, code-native bitmap brand mark. Run only when changing icons.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(directory, { recursive: true });
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}
for (const size of [192, 512]) {
  const pixels = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size; const ny = y / size;
      const n = (nx >= .25 && nx <= .31 && ny >= .40 && ny <= .66)
        || (nx >= .44 && nx <= .50 && ny >= .43 && ny <= .66)
        || (ny >= .39 && ny <= .45 && nx >= .30 && nx <= .46);
      const i = (nx >= .57 && nx <= .63 && ny >= .40 && ny <= .66)
        || ((nx - .60) ** 2 + (ny - .31) ** 2 <= .032 ** 2);
      const dot = (nx - .73) ** 2 + (ny - .63) ** 2 <= .038 ** 2;
      const color = dot ? [192, 151, 82] : n || i ? [247, 247, 242] : [22, 42, 38];
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = color[channel];
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync(`${directory}/icon-${size}.png`, png);
}
