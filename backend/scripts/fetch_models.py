"""One-time model download (run on the laptop, with internet).

    python -m scripts.fetch_models            # CLIP + the configured text encoder
    python -m scripts.fetch_models --all      # also every E7 candidate encoder

Each model is downloaded from Hugging Face, loaded WITHOUT remote code, and saved
again in safetensors format under MODELS_DIR. openai/clip-vit-base-patch32 ships
only pytorch_model.bin, so it is read with torch.load(weights_only=True) (the
default since PyTorch 2.6) and converted once. The worker then loads local
safetensors only (S2).
"""
from __future__ import annotations

import argparse
import json
import sys

import torch

from app.ml.inference import local_dir, weights_hash
from app.scoring.params import load_params


def save_clip(name: str) -> None:
    from transformers import CLIPModel, CLIPProcessor

    out = local_dir(name)
    model = CLIPModel.from_pretrained(name, trust_remote_code=False)
    CLIPProcessor.from_pretrained(name).save_pretrained(out)
    model.save_pretrained(out, safe_serialization=True)
    print(f"saved {name} -> {out} ({weights_hash(out)})")


def save_encoder(name: str) -> None:
    from sentence_transformers import SentenceTransformer

    out = local_dir(name)
    model = SentenceTransformer(name, trust_remote_code=False, device="cpu")
    model.save(str(out), safe_serialization=True)
    print(f"saved {name} -> {out} ({weights_hash(out)})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="also fetch every E7 candidate encoder")
    args = ap.parse_args()
    major, minor = (int(x) for x in torch.__version__.split(".")[:2])
    if (major, minor) < (2, 6):
        print("PyTorch >= 2.6 is required so torch.load defaults to weights_only=True", file=sys.stderr)
        return 1
    params = load_params()
    save_clip(params.ml.clip_model)
    names = [c.name for c in params.ml.encoder_candidates] if args.all else [params.ml.text_encoder]
    for name in names:
        save_encoder(name)
    manifest = {n: weights_hash(local_dir(n)) for n in [params.ml.clip_model, *names]}
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
