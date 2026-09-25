from PIL import Image, ImageDraw
from pathlib import Path
root = Path(__file__).resolve().parent.parent / 'public'
for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')]:
    scale = 4
    canvas = Image.new('RGB', (size * scale, size * scale), '#07111f')
    draw = ImageDraw.Draw(canvas)
    unit = size * scale / 192
    def line(points, color, width):
        coords = [(round(x*unit), round(y*unit)) for x,y in points]
        draw.line(coords, fill=color, width=round(width*unit))
        for x,y in coords:
            radius = width*unit/2
            draw.ellipse((x-radius,y-radius,x+radius,y+radius),fill=color)
    line([(51,56),(141,56)], '#7fd1ff', 16)
    line([(96,58),(96,129)], '#7fd1ff', 16)
    draw.ellipse(tuple(round(x*unit) for x in (75,121,117,163)), outline='#96e6c1', width=round(10*unit))
    canvas.resize((size,size),Image.Resampling.LANCZOS).save(root/name, optimize=True)
