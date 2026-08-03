#!/usr/bin/env python3
"""public/assets/destination.png via Pillow: a landing dock / server rack icon."""
from PIL import Image, ImageDraw, ImageFilter
import math

SIZE = 640
img = Image.new("RGB", (SIZE, SIZE), (11, 14, 20))

# soft vertical glow
glow = Image.new("RGB", (SIZE, SIZE), (6, 8, 12))
gd = ImageDraw.Draw(glow)
for r in range(SIZE // 2, 0, -3):
    t = 1 - r / (SIZE / 2)
    c = (int(11 + 24 * t * 0.4), int(14 + 38 * t * 0.4), int(20 + 66 * t * 0.4))
    gd.ellipse([SIZE / 2 - r, SIZE / 2 - r, SIZE / 2 + r, SIZE / 2 + r], fill=c)
glow = glow.filter(ImageFilter.GaussianBlur(30))
img.paste(glow, (0, 0))

d = ImageDraw.Draw(img, "RGBA")
# Server rack: 3 stacked units, neon green LED
rack_x, rack_y = 200, 200
rw, rh = 240, 240
hdr_h = 18
unit_gap = 8
unit_h = (rh - hdr_h - 2 * unit_gap) / 3

# Halo behind
halo = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
hd = ImageDraw.Draw(halo)
hd.rectangle([rack_x - 12, rack_y - 12, rack_x + rw + 12, rack_y + rh + 12], fill=(61, 123, 253, 70))
halo = halo.filter(ImageFilter.GaussianBlur(8))
img.paste(halo, (0, 0), halo)

d2 = ImageDraw.Draw(img, "RGBA")
# outer frame
_d2 = ImageDraw.Draw(img, "RGBA")
def round_rect(draw, box, radius, outline=None, width=1, fill=None):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=radius, outline=outline, width=width, fill=fill) if hasattr(draw, "rounded_rectangle") else draw.rectangle(box, outline=outline, width=width, fill=fill)
round_rect(d2, [rack_x, rack_y, rack_x + rw, rack_y + rh], 12, outline=(245, 247, 250, 255), width=3)
y = rack_y + hdr_h
for i in range(3):
    by = y + i * (unit_h + unit_gap)
    round_rect(d2, [rack_x + 14, by, rack_x + rw - 14, by + unit_h], 6, outline=(120, 160, 220, 200), width=2)
    # LED dots
    for k, col in enumerate([(22, 199, 132), (255, 209, 102), (61, 123, 253)]):
        cx = rack_x + 36 + k * 26
        cy = by + unit_h / 2
        d2.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=(*col, 255))
    # slot lines
    d2.line([rack_x + 130, by + unit_h / 3, rack_x + rw - 28, by + unit_h / 3], fill=(120, 160, 220, 140), width=2)
    d2.line([rack_x + 130, by + 2 * unit_h / 3, rack_x + rw - 28, by + 2 * unit_h / 3], fill=(120, 160, 220, 140), width=2)

# Arrival beam pointing in from upper-right
beam = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
bd = ImageDraw.Draw(beam)
bd.line([(560, 90), (rack_x + rw / 2, rack_y + rh / 2)], fill=(255, 209, 102, 220), width=5)
beam = beam.filter(ImageFilter.GaussianBlur(2))
img.paste(beam, (0, 0), beam)

img.save("/home/tablewares/json.mp4/public/assets/destination.png")
print("saved destination.png", img.size)
