#!/usr/bin/env python3
"""Produce public/assets/network.png via Pillow directly (no rsvg).
A neon network globe: nodes + edges + a colorful packet arc.
Dark navy bg matching framework 'shade1' #0B0E14."""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, random

random.seed(7)
SIZE = 640
img = Image.new("RGB", (SIZE, SIZE), (11, 14, 20))  # shade1 #0B0E14

# Radial navy→near-black bg glow centered slight upper-left
glow = Image.new("RGB", (SIZE, SIZE), (6, 8, 12))
gd = ImageDraw.Draw(glow)
for r in range(SIZE // 2, 0, -2):
    t = 1 - r / (SIZE / 2)
    c = (
        int(11 + 26 * t * 0.55),
        int(14 + 40 * t * 0.55),
        int(20 + 70 * t * 0.55),
    )
    gd.ellipse([SIZE / 2 - r, SIZE / 2 - r, SIZE / 2 + r, SIZE / 2 + r], fill=c)
glow = glow.filter(ImageFilter.GaussianBlur(40))
img = ImageChops.screen(img, glow)
d = ImageDraw.Draw(img, "RGBA")

CX, CY = SIZE / 2, SIZE / 2 + 6
R = 230
N = 15
nodes = []
for i in range(N):
    a = i * (2 * math.pi / N) + random.uniform(-0.13, 0.13)
    rad = R * (0.80 + random.uniform(0, 0.22))
    x = CX + rad * math.cos(a)
    y = CY + rad * math.sin(a)
    spoke = (x - CX, y - CY)
    L = math.hypot(*spoke)
    y -= spoke[1] / L * 28  # flatten to make a globe silhouette
    nodes.append((x, y, random.uniform(0.85, 1)))

# Edges: connect to angular neighbours + near-radius chords
edges = []
for i in range(N):
    for j in (i + 2, i + 5, i + 9):
        edges.append((i, j % N, random.uniform(0.25, 0.6)))

# Glow layer (soft cyan)
glow_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gld = ImageDraw.Draw(glow_layer)
for a, b, op in edges:
    x1, y1, s1 = nodes[a]
    x2, y2, s2 = nodes[b]
    gld.line([(x1, y1), (x2, y2)], fill=(61, 123, 253, int(255 * op)), width=6)
gld = glow_layer.filter(ImageFilter.GaussianBlur(6))
img.paste(gld, (0, 0), gld)

# Sharp edges
d2 = ImageDraw.Draw(img, "RGBA")
for a, b, op in edges:
    x1, y1, s1 = nodes[a]
    x2, y2, s2 = nodes[b]
    d2.line([(x1, y1), (x2, y2)], fill=(61, 123, 253, int(220 * op)), width=2)

# Nodes: glow halo + crisp dot
halo = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
hd = ImageDraw.Draw(halo)
for x, y, s in nodes:
    r = 9 * s
    hd.ellipse([x - r * 2, y - r * 2, x + r * 2, y + r * 2], fill=(120, 200, 255, 80))
halo = halo.filter(ImageFilter.GaussianBlur(7))
img.paste(halo, (0, 0), halo)
sharp = ImageDraw.Draw(img, "RGBA")
for x, y, s in nodes:
    r = 5 * s
    sharp.ellipse([x - r, y - r, x + r, y + r], fill=(245, 247, 250, 255))
    sharp.ellipse([x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45], fill=(255, 255, 255, 255))

# Bright packet hop arc: two chosen nodes, glowing arc between them
def arc_pts(x1, y1, x2, y2, bulge=0.35, n=70):
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    dx, dy = x2 - x1, y2 - y1
    nx, ny = -dy, dx
    L = math.hypot(nx, ny) or 1
    nx, ny = nx / L, ny / L
    mx += nx * bulge * math.hypot(dx, dy)
    my += ny * bulge * math.hypot(dx, dy)
    pts = []
    for t in range(n + 1):
        u = t / n
        x = (1 - u) ** 2 * x1 + 2 * (1 - u) * u * mx + u * u * x2
        y = (1 - u) ** 2 * y1 + 2 * (1 - u) * u * my + u * u * y2
        pts.append((x, y))
    return pts

a, b = 1, 9
x1, y1, _s = nodes[a]
x2, y2, _s = nodes[b]
pts = arc_pts(x1, y1, x2, y2, bulge=0.45)
arc_glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ad = ImageDraw.Draw(arc_glow)
ad.line(pts, fill=(255, 209, 102, 230), width=7, joint="curve")
ad.line(pts, fill=(255, 240, 180, 255), width=2, joint="curve")
arc_glow = arc_glow.filter(ImageFilter.GaussianBlur(3))
img.paste(arc_glow, (0, 0), arc_glow)
img.save("/home/tablewares/json.mp4/public/assets/network.png")
print("saved network.png", img.size)
