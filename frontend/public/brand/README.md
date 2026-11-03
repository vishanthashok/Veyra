# Veyra identity

The V is built from two intersecting structural forms on a 128-unit grid. The right arm begins eight units higher; a recessed joint in the left arm adds a recognizable detail without breaking the silhouette. The wordmark uses outlined Geist SemiBold. No installed font is needed to display any asset.

| Asset | Use |
| --- | --- |
| `veyra-logo.svg` / `.png` | Primary, transparent, for light backgrounds |
| `veyra-logo-light.svg` / `.png` | Teal mark and charcoal wordmark |
| `veyra-logo-dark.svg` / `.png` | Teal/mint mark and white wordmark, transparent |
| `veyra-logo-mono.svg` / `.png` | Single charcoal ink for documents |
| `veyra-logo-mono-white.svg` / `.png` | Reversed single white ink |
| `veyra-icon.svg` / `.png` | Mint rounded-square app icon; default PNG is 256px |
| `veyra-mark.svg`, `veyra-mark-dark.svg` | Transparent monograms for compact navigation |
| `veyra-icon-{size}.png` | 16, 24, 32, 64, 128, 180, 192, 256, 512, 1024px |
| `veyra-favicon-32.png`, `veyra-favicon.ico` | Browser icons; ICO includes 16/32/48/64/128/256px |
| `veyra-contact-sheet.png` | All variations and actual-size small icon proofs |

Use the monogram below 96px lockup width. Retain the SVG canvas padding as minimum clear space. Keep the palette unchanged; do not stretch, add shadows, or recreate the wordmark in live text. Dark variants require a dark surface. The rounded icon has transparent corners and an opaque mint interior.

All lockup PNGs are 1800 × 598px, rendered directly with Sharp from their corresponding SVG master. Browser branding uses SVG wherever possible. `BrandLogo` accepts `collapsed`, `theme`, and `size` (canvas height in pixels). Automatic theme follows OS preference unless the root has `data-theme="light"`, `data-theme="dark"`, or the `dark` class.

## Rebuild

Run from `frontend/`, with Python 3 and Node 20+:

```sh
python3 -m pip install fonttools==4.61.1 Pillow==12.3.0
npm install --no-save --package-lock=false sharp@0.35.5
python3 scripts/brand/generate.py
node scripts/brand/render.cjs
python3 scripts/brand/contact-sheet.py
node scripts/brand/verify.cjs
```

Geist font source and its SIL Open Font License are included in `scripts/brand/`. Font source: vercel/geist-font commit `a2357c1398c81d88ff84823a2f50af3152ee8733`, `fonts/Geist/ttf/Geist-SemiBold.ttf`. The outlined wordmark is included in every logo SVG.
