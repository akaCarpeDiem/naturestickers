"""Generate Nature Stickers wordmark/mark SVGs with text converted to outlines (Young Serif, OFL)."""
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, 'public/fonts/young-serif-400.woff2')
FOREST = '#1F3A2E'

tt = TTFont(FONT)
ttf_path = '/tmp/young-serif.ttf'
tt.flavor = None
tt.save(ttf_path)
tt = TTFont(ttf_path)
gs = tt.getGlyphSet()
upem = tt['head'].unitsPerEm
cap = getattr(tt['OS/2'], 'sCapHeight', 0) or int(upem * 0.7)
blob = hb.Blob.from_file_path(ttf_path)
face = hb.Face(blob)
font = hb.Font(face)

def text_path(text, size, x0, baseline, tracking=0.0):
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    s = size / upem
    x = 0
    order = tt.getGlyphOrder()
    pen = SVGPathPen(gs)
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        tp = TransformPen(pen, (s, 0, 0, -s, x0 + (x + pos.x_offset) * s, baseline - pos.y_offset * s))
        gs[name].draw(tp)
        x += pos.x_advance + tracking * upem
    width = (x - tracking * upem) * s
    return pen.getCommands(), width

def mark(uid, x=0, y=0, size=64):
    k = size / 64
    return f'''<g transform="translate({x} {y}) scale({k})">
<defs><clipPath id="{uid}"><circle cx="32" cy="32" r="30"/></clipPath></defs>
<circle cx="32" cy="32" r="30" fill="{FOREST}"/>
<g clip-path="url(#{uid})">
<circle cx="41.5" cy="22.5" r="7.2" fill="#E8C487"/>
<path d="M-2 50 L19 26 L28.5 36 L37 28 L66 54 V66 H-2Z" fill="#A3BE94"/>
<path d="M19 26 L14.2 31.4 L18.6 30 L22.6 32.8Z" fill="#F4EBD9"/>
<path d="M37 28 L33.6 31.2 L37.2 30.4 L40.4 31.4Z" fill="#F4EBD9"/>
<path d="M-2 51 Q15 44.5 32 49.5 T66 47.5 V66 H-2Z" fill="#5F8156"/>
</g></g>'''

# Horizontal wordmark: mark + outlined text
H = 64
size = 40
d, w = text_path('Nature Stickers', size, 82, 32 + cap * size / upem / 2 + 0.5, tracking=-0.005)
W = 82 + w + 2
logo = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H}" width="{W:.0f}" height="{H}" role="img" aria-labelledby="t">
<title id="t">Nature Stickers</title>
{mark('nvm-a')}
<path fill="{FOREST}" d="{d}"/>
</svg>
'''
open(os.path.join(ROOT, 'public/logo.svg'), 'w').write(logo)
# light version for dark backgrounds
logo_light = logo.replace(f'<path fill="{FOREST}" d=', '<path fill="#F4EBD9" d=').replace('nvm-a', 'nvm-b').replace(f'<circle cx="32" cy="32" r="30" fill="{FOREST}"/>', f'<circle cx="32" cy="32" r="30" fill="{FOREST}" stroke="#F4EBD9" stroke-opacity=".55" stroke-width="2"/>', 1)
open(os.path.join(ROOT, 'public/logo-light.svg'), 'w').write(logo_light)

mark_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">{mark('nvm-f')}</svg>\n'''
open(os.path.join(ROOT, 'public/favicon.svg'), 'w').write(mark_svg)
open(os.path.join(ROOT, 'public/logo-mark.svg'), 'w').write(mark_svg)
print('wordmark width', round(W, 1), 'cap', cap, 'upem', upem)
