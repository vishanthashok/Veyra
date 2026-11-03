const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const out = path.resolve(__dirname, '../../public/brand');
(async () => {
  for (const name of ['veyra-logo', 'veyra-logo-dark', 'veyra-logo-light', 'veyra-logo-mono', 'veyra-logo-mono-white']) {
    const svg = await fs.readFile(path.join(out, `${name}.svg`), 'utf8');
    assert(!/<text|<image|<linearGradient|<filter/.test(svg), `${name}: must be self-contained vector paths`);
    const png = sharp(path.join(out, `${name}.png`));
    const m = await png.metadata();
    assert.equal(m.width, 1800);
    assert(m.hasAlpha);
    const actual = await png.ensureAlpha().raw().toBuffer();
    const expected = await sharp(Buffer.from(svg), { density: 384 }).resize({ width: 1800 }).ensureAlpha().raw().toBuffer();
    assert(actual.equals(expected), `${name}: PNG differs from SVG render`);
    assert.equal(actual[3], 0, `${name}: canvas must be transparent`);
  }
  for (const size of [16, 24, 32, 64, 128, 180, 192, 256, 512, 1024]) {
    const m = await sharp(path.join(out, `veyra-icon-${size}.png`)).metadata();
    assert.equal(m.width, size); assert.equal(m.height, size); assert(m.hasAlpha);
  }
  const ico = await fs.readFile(path.join(out, 'veyra-favicon.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 6);
  assert(ico.equals(await fs.readFile(path.resolve(out, '../../app/favicon.ico'))));
  for (let i=0; i<6; i++) {
    const p=6+i*16, size=ico[p] || 256;
    const m=await sharp(ico.subarray(ico.readUInt32LE(p+12), ico.readUInt32LE(p+12)+ico.readUInt32LE(p+8))).metadata();
    assert.equal(m.width,size); assert.equal(m.height,size);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(out, 'site.webmanifest')));
  for (const icon of manifest.icons) await fs.access(path.join(out, path.basename(icon.src)));
  console.log('PASS: SVG/PNG pixel parity, transparency, 10 icon sizes, 6 ICO frames, manifest asset paths.');
})().catch(error => { console.error(error); process.exit(1); });
