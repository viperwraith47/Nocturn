/**
 * Generates Nocturn extension icon PNGs using `sharp`.  Run with:
 *   node scripts/generate-icons.js
 *
 * Produces two variants per size:
 *  - icon-<size>.png     (active / colored — shown when Nocturn is on)
 *  - icon-<size>-off.png (disabled / dimmed — shown when Nocturn is off)
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.resolve(__dirname, '..', 'assets', 'icons');

// Active icon: a crescent moon on a dark background.
// Accent uses twilight indigo (#818cf8) — the night-sky hue shared
// with the popup/options UI, tying the brand to a cohesive color story.
const ACTIVE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="24" fill="#0e0e10"/>
  <path d="M64 16a44 44 0 1 0 44 44 44.05 44.05 0 0 1-44-44z" fill="#818cf8" stroke="#3a3a3f" stroke-width="2"/>
  <path d="M88 36a4 4 0 0 0 0 8 4 4 0 0 0 0-8zM28 76a4 4 0 0 0 0 8 4 4 0 0 0 0-8z" fill="#818cf8"/>
  <path d="M92 84a4 4 0 0 0 0 8 4 4 0 0 0 0-8zM48 28a4 4 0 0 0 0 8 4 4 0 0 0 0-8z" fill="#a8a4ff" opacity="0.9"/>
  <path d="M64 12v8M64 108v8M16 64h8M104 64h8" stroke="#818cf8" stroke-width="3" stroke-linecap="round" opacity="0.4"/>
</svg>`;

// Disabled icon: same shape but desaturated / dimmed.
const DISABLED_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="24" fill="#0e0e10"/>
  <path d="M64 16a44 44 0 1 0 44 44 44.05 44.05 0 0 1-44-44z" fill="#8a8a94" stroke="#3a3a3f" stroke-width="2"/>
  <path d="M88 36a4 4 0 0 0 0 8 4 4 0 0 0 0-8zM28 76a4 4 0 0 0 0 8 4 4 0 0 0 0-8z" fill="#8a8a94"/>
  <path d="M92 84a4 4 0 0 0 0 8 4 4 0 0 0 0-8zM48 28a4 4 0 0 0 0 8 4 4 0 0 0 0-8z" fill="#8a8a94" opacity="0.9"/>
  <path d="M64 12v8M64 108v8M16 64h8M104 64h8" stroke="#8a8a94" stroke-width="3" stroke-linecap="round" opacity="0.4"/>
</svg>`;

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

(async () => {
  for (const size of SIZES) {
    // Active icon (colored)
    await sharp(Buffer.from(ACTIVE_SVG))
      .resize(size, size)
      .png()
      .toFile(path.join(OUT_DIR, `icon-${size}.png`));
    console.log(`✓ icon-${size}.png (${size}x${size}) — active`);

    // Disabled icon (dimmed)
    await sharp(Buffer.from(DISABLED_SVG))
      .resize(size, size)
      .png()
      .toFile(path.join(OUT_DIR, `icon-${size}-off.png`));
    console.log(`✓ icon-${size}-off.png (${size}x${size}) — disabled`);
  }
  console.log('\nAll icons generated in', OUT_DIR);
})().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
