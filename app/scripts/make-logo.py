"""Builds the Vortex Desk logo files from the chosen artwork (logo-source.png).
   python scripts/make-logo.py   ->  assets/logo-512.png, logo-256.png, icon.ico, tray-32.png, tray-16.png, logo-96.b64.txt"""
import base64, io, os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', '..', 'assets')
src = Image.open(os.path.join(ASSETS, 'logo-source.png')).convert('RGB')

# crop a square around the orb and its ring, then round the corners like a modern app icon
cx, cy, half = 620, 610, 515
sq = src.crop((cx - half, cy - half, cx + half, cy + half)).convert('RGBA')

def rounded(im, size, radius=0.22):
    im = im.resize((size, size), Image.LANCZOS)
    m = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * radius), fill=255)
    im.putalpha(m.resize((size, size), Image.LANCZOS))
    return im

sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512]
out = {s: rounded(sq, s) for s in sizes}
for s in (512, 256, 96, 32, 16):
    out[s].save(os.path.join(ASSETS, f'logo-{s}.png' if s > 32 else f'tray-{s}.png' if s in (16, 32) else f'logo-{s}.png'))
out[256].save(os.path.join(ASSETS, 'icon.ico'), sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)], append_images=[out[s] for s in (16, 24, 32, 48, 64, 128)])
buf = io.BytesIO(); out[96].save(buf, 'PNG', optimize=True)
open(os.path.join(ASSETS, 'logo-96.b64.txt'), 'w').write(base64.b64encode(buf.getvalue()).decode())
print('ok', sorted(os.listdir(ASSETS)))
