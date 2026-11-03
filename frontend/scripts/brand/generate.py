"""Build font-independent SVG masters. Requires fonttools==4.61.1."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'public' / 'brand'
OUT.mkdir(parents=True, exist_ok=True)
font = TTFont(HERE / 'Geist-SemiBold.ttf')
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
scale = 82 / font['head'].unitsPerEm
x, paths = 144, []
for char in 'Veyra':
    name = cmap[ord(char)]
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 88)))
    paths.append(pen.getCommands())
    x += font['hmtx'][name][0] * scale - 1.6
width = round(x + 15)
word = ''.join(f'<path d="{p}"/>' for p in paths)
left = 'M16 24H40L55 57H47L68 104H52Z'
right = 'M88 16H112L72 104H52Z'

def mark(a, b):
    return f'<path fill="{a}" d="{left}"/><path fill="{b}" d="{right}"/>'

def svg(w, h, body, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'

for name, a, b, ink in [
    ('veyra-logo', '#075D56', '#137F73', '#111316'),
    ('veyra-logo-light', '#075D56', '#137F73', '#111316'),
    ('veyra-logo-dark', '#137F73', '#DDF4EE', '#FFFFFF'),
    ('veyra-logo-mono', '#111316', '#111316', '#111316'),
    ('veyra-logo-mono-white', '#FFFFFF', '#FFFFFF', '#FFFFFF'),
]:
    (OUT / f'{name}.svg').write_text(svg(width, 128, mark(a, b) + f'<g fill="{ink}">{word}</g>', 'Veyra'))
(OUT / 'veyra-icon.svg').write_text(svg(128, 128, '<rect width="128" height="128" rx="28" fill="#DDF4EE"/><g transform="translate(12 15.25) scale(.8125)">' + mark('#075D56', '#137F73') + '</g>', 'Veyra app icon'))
(OUT / 'veyra-mark.svg').write_text(svg(128, 128, mark('#075D56', '#137F73'), 'Veyra monogram'))
(OUT / 'veyra-mark-dark.svg').write_text(svg(128, 128, mark('#137F73', '#DDF4EE'), 'Veyra monogram'))
print(f'SVG masters created in {OUT} ({width} × 128 lockup)')
