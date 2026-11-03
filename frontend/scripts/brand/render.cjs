/* npm install --no-save --package-lock=false sharp@0.35.5 */
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const out = path.resolve(__dirname, '../../public/brand');
async function render(source, target, width) {
  await sharp(path.join(out, source), { density: 384 }).resize({ width }).png().toFile(path.join(out, target));
}
(async () => {
  for (const name of ['veyra-logo', 'veyra-logo-dark', 'veyra-logo-light', 'veyra-logo-mono', 'veyra-logo-mono-white']) {
    await render(`${name}.svg`, `${name}.png`, 1800);
  }
  for (const size of [16, 24, 32, 64, 128, 180, 192, 256, 512, 1024]) {
    await render('veyra-icon.svg', `veyra-icon-${size}.png`, size);
  }
  await fs.copyFile(path.join(out, 'veyra-icon-256.png'), path.join(out, 'veyra-icon.png'));
  await fs.copyFile(path.join(out, 'veyra-icon-32.png'), path.join(out, 'veyra-favicon-32.png'));
  // ICO directory with PNG payloads: 16/32/48/64/128/256, supported by modern browsers.
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = [];
  for (const width of sizes) images.push(await sharp(path.join(out, 'veyra-icon.svg'), { density: 384 }).resize(width, width).png().toBuffer());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const p = 6 + i * 16;
    header[p] = size === 256 ? 0 : size; header[p + 1] = header[p];
    header.writeUInt16LE(1, p + 4); header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(images[i].length, p + 8); header.writeUInt32LE(offset, p + 12);
    offset += images[i].length;
  });
  const ico = Buffer.concat([header, ...images]);
  await fs.writeFile(path.join(out, 'veyra-favicon.ico'), ico);
  await fs.writeFile(path.resolve(out, '../../app/favicon.ico'), ico);
  console.log('Rendered 1800px transparent lockups, 16–1024px icons, and multi-resolution ICO.');
})().catch(error => { console.error(error); process.exit(1); });
