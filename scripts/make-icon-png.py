"""Render assets/icon-180.png for the awesome-dsh-plugin market entry.

Redraws the plugin's icon.svg design at 4x supersampling with Pillow and
downscales to 180px, because no SVG rasterizer is available offline.
Layout mirrors icon.svg's 64x64 viewBox (factor 11.25 per unit).
"""
from PIL import Image, ImageDraw

S = 720  # 4x supersample of 180
f = S / 64.0

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded brand square (64x64, rx=14, #1f6feb)
d.rounded_rectangle((0, 0, S - 1, S - 1), radius=round(14 * f), fill="#1f6feb")

# Large white speech bubble: x13 y13 w32 h25 rx6, with tail
bx0, by0, bx1, by1 = 13 * f, 13 * f, 45 * f, 38 * f
d.rounded_rectangle((bx0, by0, bx1, by1), radius=round(6 * f), fill="#ffffff")
d.polygon(
    [(30 * f, by1 - 1), (30 * f, 51 * f), (37 * f, by1 - 1)],
    fill="#ffffff",
)
# Three brand dots inside the large bubble (cy 25.5, r 2.4)
for cx in (23, 31, 39):
    r = 2.4 * f
    cy = 25.5 * f
    d.ellipse((cx * f - r, cy - r, cx * f + r, cy + r), fill="#1f6feb")

# Small light-blue reply bubble: x31 y37 w21 h19 rx5, with tail
sx0, sy0, sx1, sy1 = 31 * f, 37 * f, 52 * f, 56 * f
d.rounded_rectangle((sx0, sy0, sx1, sy1), radius=round(5 * f), fill="#a8cfff")
d.polygon(
    [(40 * f, sy1 - 1), (40 * f, 62 * f), (46 * f, sy1 - 1)],
    fill="#a8cfff",
)
# Three small dots inside the reply bubble (cy 46, r 1.8)
for cx in (38, 44, 50):
    r = 1.8 * f
    cy = 46 * f
    d.ellipse((cx * f - r, cy - r, cx * f + r, cy + r), fill="#1f4b8f")

out = img.resize((180, 180), Image.LANCZOS)
out.save("assets/icon-180.png")
print("assets/icon-180.png written:", out.size)
