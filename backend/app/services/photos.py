"""Photo intake (spec §8 "Photo uploads"): magic bytes, size and pixel limits, Pillow re-encode
(drops metadata and embedded content), random file name outside any web root, SHA-256 + pHash."""
from __future__ import annotations

import hashlib
import io
import uuid
from dataclasses import dataclass
from pathlib import Path

import imagehash
from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps

from app.config import settings
from app.core.params import get_params
from app.core.timeutil import now_utc

MAGIC = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
}


@dataclass(frozen=True)
class StoredPhoto:
    relpath: str
    width: int
    height: int
    size: int
    sha256: str
    phash: str      # 64 characters of 0/1


def sniff(head: bytes) -> str | None:
    for sig, mime in MAGIC.items():
        if head.startswith(sig):
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def read_limited(upload: UploadFile) -> bytes:
    limit = get_params().uploads.max_bytes
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"Photo is too big. The limit is {limit // (1024 * 1024)} MB. Retake it.")
    if not data:
        raise HTTPException(status_code=422, detail="The photo is empty. Retake it.")
    return data


def process_image(data: bytes) -> tuple[bytes, int, int, str]:
    """Validate by real content and re-encode to JPEG. Returns (jpeg bytes, w, h, phash bits)."""
    if sniff(data[:16]) is None:
        raise HTTPException(status_code=415, detail="This file is not a photo. Retake it with the camera.")
    up = get_params().uploads
    Image.MAX_IMAGE_PIXELS = up.max_pixels
    try:
        with Image.open(io.BytesIO(data)) as probe:
            w, h = probe.size
            if w * h > up.max_pixels:
                raise HTTPException(status_code=413, detail="Photo has too many pixels. Retake it.")
            probe.verify()
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im)
            im = im.convert("RGB")
            im.thumbnail((up.max_side_px, up.max_side_px))
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=85, optimize=True)   # no EXIF is written
            bits = "".join("1" if b else "0" for b in imagehash.phash(im).hash.flatten())
            return out.getvalue(), im.width, im.height, bits
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise HTTPException(status_code=415, detail="This photo could not be read. Retake it.")


def store(jpeg: bytes, width: int, height: int, phash: str) -> StoredPhoto:
    now = now_utc()
    rel = Path(f"{now:%Y}") / f"{now:%m}" / f"{uuid.uuid4().hex}.jpg"
    full = Path(settings.UPLOAD_DIR) / rel
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(jpeg)
    return StoredPhoto(str(rel), width, height, len(jpeg), hashlib.sha256(jpeg).hexdigest(), phash)


def intake(upload: UploadFile) -> StoredPhoto:
    jpeg, w, h, bits = process_image(read_limited(upload))
    return store(jpeg, w, h, bits)


def abs_path(relpath: str) -> Path:
    base = Path(settings.UPLOAD_DIR).resolve()
    full = (base / relpath).resolve()
    if base not in full.parents:          # never serve anything outside the uploads folder
        raise HTTPException(status_code=404, detail="Not found")
    return full


def hamming(a: str, b: str) -> int:
    return sum(1 for x, y in zip(a, b) if x != y)
