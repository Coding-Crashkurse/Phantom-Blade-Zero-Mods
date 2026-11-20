"""Draws the gauntlet screen's ink pictures into boss-gauntlets/art: python boss-gauntlets/make_art.py

Every picture is white with an alpha channel, so the mod gives it its colour (ink black, blood red, bone white).
    stroke.png  a wide brush stroke: the bar behind a name
    line.png    a thin brush line: under the title, between the parts
    cross.png   two crossing strokes: over a beaten opponent
    frame.png   a square brush frame: around a portrait
    wash.png    a large ink wash with torn edges: behind the board's parts
    seal.png    a square stamp: under the rank
"""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent / "art"


def smooth(rng, n, knots):
    """n values between 0 and 1 that change slowly: `knots` random values, joined by a smooth curve."""
    values = rng.random(knots + 3)
    at = np.linspace(0, knots, n)
    i = at.astype(int)
    t = at - i
    t = t * t * (3 - 2 * t)
    return values[i] * (1 - t) + values[i + 1] * t


def stroke(width, height, seed, dry=0.55, thickness=0.8):
    """A brush stroke from left to right as an alpha array (0 to 1)."""
    rng = np.random.default_rng(seed)
    x = np.arange(width)[None, :]
    v = np.linspace(-1, 1, height)[:, None]
    # The stroke's body: a band whose thickness and middle wander a little.
    half = thickness * (0.82 + 0.18 * smooth(rng, width, 9))[None, :]
    middle = 0.06 * (smooth(rng, width, 5) - 0.5)[None, :]
    body = np.clip((half - np.abs(v - middle)) * height / 4, 0, 1)
    # Each bristle (a row) starts and ends at its own place.
    rows = smooth(rng, height, height // 5) * 0.6 + rng.random(height) * 0.4
    start = (0.02 * width + 0.05 * width * rows ** 2)[:, None]
    end = (width - 0.03 * width - 0.22 * width * (smooth(rng, height, height // 4) * 0.5 + rng.random(height) * 0.5) ** 2)[:, None]
    ends = np.clip((x - start) / 5, 0, 1) * np.clip((end - x) / 14, 0, 1)
    # Dry brush: some bristles run out of ink toward the end.
    thirst = (smooth(rng, height, height // 3) * 0.5 + rng.random(height) * 0.5)[:, None]
    along = np.clip((x / width - 0.25) / 0.75, 0, 1) ** 1.5
    gaps = 1 - dry * along * (thirst > 0.45) * (0.6 + 0.4 * smooth(rng, width, 40))[None, :]
    return np.clip(body * ends * gaps, 0, 1)


def save(alpha, name):
    alpha = np.clip(alpha, 0, 1)
    rgba = np.zeros(alpha.shape + (4,), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    OUT.mkdir(exist_ok=True)
    Image.fromarray(rgba).save(OUT / name)
    print(f"drew {OUT / name}")


def rotated(alpha, angle, size):
    """An alpha array turned by an angle, in the middle of a square of the given size."""
    image = Image.fromarray((alpha * 255).astype(np.uint8)).rotate(angle, resample=Image.BICUBIC, expand=True)
    canvas = Image.new("L", (size, size))
    canvas.paste(image, ((size - image.width) // 2, (size - image.height) // 2))
    return np.asarray(canvas) / 255


def cross(size=320):
    one = rotated(stroke(int(size * 1.25), size // 6, 11, dry=0.5), 47, size)
    two = rotated(stroke(int(size * 1.2), size // 7, 12, dry=0.7), -44, size)
    return np.maximum(one, two)


def frame(size=256, seed=21):
    """A square outline drawn with four strokes."""
    alpha = np.zeros((size, size))
    thick = size // 9
    for side in range(4):
        line = np.zeros((size, size))
        line[:thick, :] = stroke(size, thick, seed + side, dry=0.35, thickness=0.75)
        alpha = np.maximum(alpha, np.rot90(line, side))
    return alpha


def wash(width=1024, height=640, seed=31):
    """A large area of ink: full in the middle, torn and streaky at the edges."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:height, 0:width]
    left = 26 + 60 * smooth(rng, height, 30)[:, None] ** 2 + 30 * rng.random(height)[:, None]
    right = 26 + 90 * smooth(rng, height, 30)[:, None] ** 2 + 60 * rng.random(height)[:, None] ** 2
    top = 14 + 22 * smooth(rng, width, 40)[None, :]
    bottom = 14 + 26 * smooth(rng, width, 40)[None, :]
    alpha = np.clip((x - left) / 8, 0, 1) * np.clip((width - right - x) / 16, 0, 1)
    alpha *= np.clip((y - top) / 6, 0, 1) * np.clip((height - bottom - y) / 6, 0, 1)
    # Streaks along the brush's way, stronger toward the right.
    streaks = (smooth(rng, height, height // 3) * 0.5 + rng.random(height) * 0.5)[:, None]
    along = np.clip((x / width - 0.5) / 0.5, 0, 1) ** 2
    alpha *= 1 - 0.35 * along * (streaks > 0.5)
    return alpha * (0.94 + 0.06 * smooth(rng, width, 12)[None, :])


def seal(size=320, seed=41):
    """A stamp: a square pressed onto paper, its edge uneven, the ink missing in specks."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size]
    edge = lambda: 10 + 9 * smooth(rng, size, 14)
    alpha = np.clip((x - edge()[:, None]) / 3, 0, 1) * np.clip((size - edge()[:, None] - x) / 3, 0, 1)
    alpha *= np.clip((y - edge()[None, :]) / 3, 0, 1) * np.clip((size - edge()[None, :] - y) / 3, 0, 1)
    # Specks: a coarse random pattern, enlarged, takes ink away here and there.
    coarse = np.asarray(Image.fromarray((rng.random((size // 4, size // 4)) * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC)) / 255
    fine = rng.random((size, size))
    alpha *= 1 - 0.55 * (coarse > 0.72) * (fine > 0.35)
    return alpha * (0.9 + 0.1 * fine)


if __name__ == "__main__":
    save(stroke(1024, 128, 1), "stroke.png")
    save(stroke(1024, 24, 2, dry=0.3, thickness=0.6), "line.png")
    save(cross(), "cross.png")
    save(frame(), "frame.png")
    save(wash(), "wash.png")
    save(seal(), "seal.png")
