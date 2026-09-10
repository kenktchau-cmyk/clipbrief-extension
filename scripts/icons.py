from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'icons'
root.mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    scale = 4
    image = Image.new('RGBA', (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, size * scale - 1, size * scale - 1), radius=size * scale * 0.26, fill='#223e37')
    draw.polygon([(size * scale * .39, size * scale * .26), (size * scale * .73, size * scale * .5), (size * scale * .39, size * scale * .74)], fill='#dde88d')
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / f'{size}.png')
print('Created four extension icons.')
