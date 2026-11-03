"""Assemble the exported assets at native resolution; requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'public' / 'brand'
canvas = Image.new('RGB', (1800, 1660), '#FAFAF8')
d = ImageDraw.Draw(canvas)
def font(size): return ImageFont.truetype(str(HERE / 'Geist-SemiBold.ttf'), size)
def label(x, y, text, size=23, fill='#5D6966'):
    d.text((x, y), text, font=font(size), fill=fill)
def asset(name, box, max_size):
    im = Image.open(OUT / name).convert('RGBA')
    im.thumbnail(max_size, Image.Resampling.LANCZOS)
    x, y, w, h = box
    canvas.paste(im, (x + (w-im.width)//2, y + (h-im.height)//2), im)

d.rectangle((0, 0, 1800, 155), fill='#111316')
label(60, 45, 'VEYRA', 38, '#DDF4EE')
label(60, 101, 'Official identity / Logo variations and small-size proof', 21, '#B5C1BE')
cards = [
    (60, 200, '01 / Primary · light', 'veyra-logo-light.png', '#FFFFFF'),
    (930, 200, '02 / Dark mode', 'veyra-logo-dark.png', '#111316'),
    (60, 510, '03 / App icon', 'veyra-icon-512.png', '#FFFFFF'),
    (930, 510, '04 / Monochrome', 'veyra-logo-mono.png', '#FFFFFF'),
    (60, 820, '05 / Transparent export', 'veyra-logo.png', None),
    (930, 820, '06 / Reversed monochrome', 'veyra-logo-mono-white.png', '#111316'),
]
for x, y, title, name, bg in cards:
    label(x, y, title)
    bx, by, bw, bh = x, y+43, 810, 230
    if bg: d.rectangle((bx, by, bx+bw, by+bh), fill=bg)
    else:
        for a in range(0, bw, 15):
            for b in range(0, bh, 15):
                d.rectangle((bx+a, by+b, min(bx+a+14, bx+bw), min(by+b+14, by+bh)), fill='#EEF1EE' if (a//15+b//15)%2 else '#FFFFFF')
    asset(name, (bx, by, bw, bh), (630, 190) if 'logo' in name else (184,184))

label(60, 1145, '07 / App icon at actual export size', 25, '#111316')
for row, bg in [(1200, '#FFFFFF'), (1400, '#111316')]:
    d.rectangle((60, row, 1740, row+170), fill=bg)
    for index, size in enumerate([16, 24, 32, 64, 128]):
        x=155+index*325
        im=Image.open(OUT/f'veyra-icon-{size}.png').convert('RGBA')
        canvas.paste(im, (x+(128-size)//2, row+(130-size)//2), im)
        label(x+34, row+136, f'{size}px', 18, '#B5C1BE' if bg=='#111316' else '#5D6966')
label(60, 1610, 'Geist SemiBold · Outlined SVG master · #137F73 / #075D56 / #DDF4EE / #111316 / #FAFAF8', 20)
canvas.save(OUT/'veyra-contact-sheet.png')
print(OUT/'veyra-contact-sheet.png')
