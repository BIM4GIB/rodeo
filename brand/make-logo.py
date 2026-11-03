# The Rodeo logo set. The mark is a lasso: the loop, the knot (honda) the rope runs through,
# the rope's tail trailing away, and a block caught in the loop: a lasso selection in CAD terms.
# The wordmark is monoline "rodeo" on circles of one radius, with round ends to match.
# Run: python3 brand/make-logo.py   (writes the SVGs next to this file)
import math, os, sys
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
ORANGE, INK, NIGHT, WHITE = "#FF5A1F", "#16140F", "#141414", "#FFFFFF"

def f(v): return f"{v:.1f}".rstrip("0").rstrip(".")

def mark(colour, s=1.0, ox=0.0, oy=0.0, sw=34):
    """The lasso around a block, in a 512 square, scaled by s and moved by (ox, oy)."""
    cx, cy, rx, ry, rot = 300, 212, 158, 122, -12
    a, r = math.radians(202), math.radians(rot)
    ex, ey = rx * math.cos(a), ry * math.sin(a)
    kx, ky = cx + ex * math.cos(r) - ey * math.sin(r), cy + ex * math.sin(r) + ey * math.cos(r)
    X = lambda x: f(ox + x * s)
    Y = lambda y: f(oy + y * s)
    w = f(sw * s)
    b = 80                                                  # the block caught in the loop
    return (
        f'<ellipse cx="{X(cx)}" cy="{Y(cy)}" rx="{f(rx*s)}" ry="{f(ry*s)}" transform="rotate({rot} {X(cx)} {Y(cy)})" fill="none" stroke="{colour}" stroke-width="{w}"/>'
        f'<rect x="{X(cx-b/2)}" y="{Y(cy-b/2)}" width="{f(b*s)}" height="{f(b*s)}" rx="{f(11*s)}" fill="{colour}"/>'
        f'<path d="M{X(kx)} {Y(ky)}C{X(kx-60)} {Y(ky+70)} {X(170)} {Y(360)} {X(104)} {Y(400)}S{X(36)} {Y(440)} {X(40)} {Y(472)}" fill="none" stroke="{colour}" stroke-width="{w}" stroke-linecap="round"/>'
        f'<circle cx="{X(kx)}" cy="{Y(ky)}" r="{f(31*s)}" fill="{colour}"/>'
    )

def wordmark(colour, s=1.0, ox=0.0, oy=0.0, sw=22):
    """'rodeo' in a 600 x 210 box: x-height 106 to 194 between stroke centres, ascender at 40."""
    r, mid, base = 44, 150, 194
    X = lambda x: f(ox + x * s)
    Y = lambda y: f(oy + y * s)
    R, W = f(r * s), f(sw * s)
    line = lambda d: f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="{W}" stroke-linecap="round" stroke-linejoin="round"/>'
    ring = lambda cx: f'<circle cx="{X(cx)}" cy="{Y(mid)}" r="{R}" fill="none" stroke="{colour}" stroke-width="{W}"/>'
    o1, d, e, o2 = 136, 268, 400, 532                       # bowl centres, 132 apart
    ea = math.radians(40)
    return "".join([
        line(f"M{X(11)} {Y(base)}V{Y(mid)}A{R} {R} 0 0 1 {X(55)} {Y(mid - r)}"),      # r
        ring(o1),                                                                     # o
        ring(d), line(f"M{X(d + r)} {Y(40)}V{Y(base)}"),                              # d
        line(f"M{X(e - r)} {Y(mid)}H{X(e + r)}A{R} {R} 0 1 0 {X(e + r * math.cos(ea))} {Y(mid + r * math.sin(ea))}"),  # e
        ring(o2),                                                                     # o
    ])

def svg(w, h, body, bg=None, rx=0, title="Rodeo"):
    back = f'<rect width="{w}" height="{h}" rx="{f(rx)}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{back}{body}</svg>\n')

# In the lockup the mark is 200 tall and centred on the wordmark's x-height.
lock = lambda word: mark(ORANGE, s=0.39, ox=4, oy=32) + wordmark(word, ox=232, oy=0)
ICON_RX = 512 * 0.22
files = {
    "rodeo-mark.svg": svg(512, 512, mark(ORANGE), title="Rodeo"),
    "rodeo-mark-white.svg": svg(512, 512, mark(WHITE), title="Rodeo"),
    "rodeo-icon.svg": svg(512, 512, mark(WHITE, s=0.8, ox=36, oy=40), bg=ORANGE, rx=ICON_RX),
    "rodeo-icon-dark.svg": svg(512, 512, mark(ORANGE, s=0.8, ox=36, oy=40), bg=NIGHT, rx=ICON_RX),
    "rodeo-logo.svg": svg(830, 230, lock(INK)),
    "rodeo-logo-white.svg": svg(830, 230, lock(WHITE)),
    "rodeo-wordmark.svg": svg(590, 210, wordmark(INK, ox=8), title="rodeo"),
}
for name, text in files.items():
    open(os.path.join(OUT, name), "w").write(text)
print(" ".join(sorted(files)))
