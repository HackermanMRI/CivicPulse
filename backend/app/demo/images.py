"""Synthetic DEMO photos: abstract drawings with a clear "DEMO · SYNTHETIC IMAGE" stamp.

They are not photographs and cannot be mistaken for real evidence. Each new image is checked against every
image made before it, so no two DEMO images are near-copies under the photo reuse check (pHash, spec W1),
unless a scenario deliberately re-uses one.
"""
from __future__ import annotations

import io
import random

import imagehash
from PIL import Image, ImageDraw, ImageFont

PALETTES = {
    "waterlogging": [(70, 110, 140), (120, 150, 170), (60, 70, 80)],
    "water_pollution": [(60, 80, 50), (90, 100, 60), (40, 50, 40)],
    "damaged_road": [(90, 90, 90), (130, 120, 110), (60, 55, 50)],
    "deforestation": [(110, 90, 60), (70, 110, 60), (150, 130, 90)],
    "drainage": [(80, 80, 70), (110, 100, 80), (50, 60, 60)],
    "garbage": [(120, 100, 80), (160, 140, 90), (90, 70, 60)],
    "streetlight": [(30, 30, 50), (200, 180, 90), (60, 60, 80)],
    "product": [(230, 220, 200), (200, 170, 120), (150, 90, 60)],
    "verification": [(80, 100, 110), (140, 150, 140), (60, 60, 60)],
}


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:          # very old Pillow without FreeType sizes
        return ImageFont.load_default()


class ImageFactory:
    def __init__(self, rng: random.Random, min_distance: int = 14):
        self.rng = rng
        self.min_distance = min_distance
        self.hashes: list[int] = []

    def _draw(self, kind: str, title: str, size: tuple[int, int]) -> Image.Image:
        r = self.rng
        w, h = size
        base = PALETTES.get(kind, PALETTES["verification"])
        im = Image.new("RGB", size, base[0])
        d = ImageDraw.Draw(im)
        # Large random shapes change the low frequencies, which is what pHash looks at.
        for _ in range(r.randint(5, 9)):
            c = tuple(max(0, min(255, v + r.randint(-60, 60))) for v in r.choice(base))
            x0, y0 = r.randint(-w // 3, w), r.randint(-h // 3, h)
            x1, y1 = x0 + r.randint(w // 5, w), y0 + r.randint(h // 5, h)
            if r.random() < 0.5:
                d.ellipse([x0, y0, x1, y1], fill=c)
            else:
                d.polygon([(x0, y0), (x1, y0 + r.randint(-h // 3, h // 3)), (x0 + r.randint(-w // 3, w // 3), y1)], fill=c)
        band_h = max(40, h // 6)
        top = r.choice([h // 12, h - band_h - h // 12])
        d.rectangle([0, top, w, top + band_h], fill=(255, 255, 255))
        big, small = _font(max(14, band_h // 3)), _font(max(11, band_h // 5))
        d.text((12, top + 6), "DEMO · SYNTHETIC IMAGE", fill=(160, 20, 20), font=big)
        d.text((12, top + 8 + band_h // 2), f"{title} - not a real photo", fill=(30, 30, 30), font=small)
        return im

    def make(self, kind: str, title: str, size: tuple[int, int] = (640, 480)) -> bytes:
        for _ in range(40):
            im = self._draw(kind, title, size)
            bits = imagehash.phash(im).hash.flatten()
            value = int("".join("1" if b else "0" for b in bits), 2)
            if all(bin(value ^ other).count("1") >= self.min_distance for other in self.hashes):
                self.hashes.append(value)
                out = io.BytesIO()
                im.save(out, format="JPEG", quality=80)
                return out.getvalue()
        raise RuntimeError("could not draw a distinct DEMO image")
