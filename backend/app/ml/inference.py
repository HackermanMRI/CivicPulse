"""Zero-shot text and image scoring for the worker (spec §5, F5–F7).

No model is trained here. Weights are read only from the local models folder in
safetensors format (prepared once by scripts/fetch_models.py), with
local_files_only=True and trust_remote_code=False (S2). torch and transformers
are imported lazily so the rest of the backend never needs them.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.scoring.components import softmax_probability
from app.scoring.params import Params

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))


def local_dir(model_name: str) -> Path:
    return MODELS_DIR / model_name.replace("/", "__")


def weights_hash(model_dir: Path) -> str:
    """SHA-256 over every safetensors file, stored in trust_scores.model_version."""
    files = sorted(model_dir.rglob("*.safetensors"))
    if not files:
        raise FileNotFoundError(f"no safetensors weights in {model_dir}; run scripts/fetch_models.py")
    h = hashlib.sha256()
    for f in files:
        with f.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
    return h.hexdigest()[:16]


def pick_device() -> str:
    """DEVICE=cuda|cpu; falls back to CPU when CUDA is missing (CPU fallback is mandatory)."""
    want = os.environ.get("DEVICE", "cpu").lower()
    if want == "cuda":
        import torch
        if torch.cuda.is_available():
            return "cuda"
    return "cpu"


@dataclass(frozen=True)
class Probability:
    p_chosen: float
    n_classes: int
    model_version: str


class TextScorer:
    """F5: cosine between the description and each category's averaged prototype embedding."""

    def __init__(self, params: Params, model_name: str | None = None, query_prefix: str | None = None):
        from sentence_transformers import SentenceTransformer

        self.params = params
        self.model_name = model_name or params.ml.text_encoder
        self.prefix = params.ml.text_query_prefix if query_prefix is None else query_prefix
        path = local_dir(self.model_name)
        self.version = f"{self.model_name}@{weights_hash(path)}"
        self.model = SentenceTransformer(
            str(path), device=pick_device(), trust_remote_code=False, local_files_only=True,
            model_kwargs={"use_safetensors": True},
        )
        self.codes = [c.code for c in params.categories]
        protos = []
        for cat in params.categories:
            vecs = self.embed(cat.text_prototypes)
            mean = vecs.mean(axis=0)
            protos.append(mean / np.linalg.norm(mean))
        self.prototypes = np.vstack(protos)

    def embed(self, texts: list[str]) -> np.ndarray:
        return np.asarray(self.model.encode([self.prefix + t for t in texts], normalize_embeddings=True))

    def probability(self, description: str, category_code: str) -> Probability:
        vec = self.embed([description])[0]
        p = softmax_probability(vec, self.prototypes, self.codes.index(category_code), self.params.ml.text_temperature)
        return Probability(p, len(self.codes), self.version)

    def top1(self, description: str) -> str:
        vec = self.embed([description])[0]
        return self.codes[int(np.argmax(self.prototypes @ vec))]


class ImageScorer:
    """F7: CLIP zero-shot over one prompt set per category plus one "unrelated scene" prompt."""

    def __init__(self, params: Params):
        import torch
        from transformers import CLIPModel, CLIPProcessor

        self.torch = torch
        self.params = params
        path = local_dir(params.ml.clip_model)
        self.version = f"{params.ml.clip_model}@{weights_hash(path)}"
        self.device = pick_device()
        self.model = CLIPModel.from_pretrained(str(path), local_files_only=True, use_safetensors=True).to(self.device).eval()
        self.processor = CLIPProcessor.from_pretrained(str(path), local_files_only=True)
        self.codes = [c.code for c in params.categories]
        prompt_sets = [c.clip_prompts for c in params.categories] + [[params.clip_unrelated_prompt]]
        with torch.no_grad():
            feats = []
            for prompts in prompt_sets:
                inputs = self.processor(text=prompts, return_tensors="pt", padding=True).to(self.device)
                t = self.model.get_text_features(**inputs)
                t = t / t.norm(dim=-1, keepdim=True)
                mean = t.mean(dim=0)
                feats.append(mean / mean.norm())
            self.text_features = torch.stack(feats)
            self.logit_scale = self.model.logit_scale.exp().item()

    def probability(self, image, category_code: str) -> Probability:
        """`image` is a PIL image (already re-encoded by the upload pipeline)."""
        torch = self.torch
        with torch.no_grad():
            inputs = self.processor(images=image, return_tensors="pt").to(self.device)
            f = self.model.get_image_features(**inputs)
            f = f / f.norm(dim=-1, keepdim=True)
            probs = (self.logit_scale * f @ self.text_features.T).softmax(dim=-1)[0]
        return Probability(float(probs[self.codes.index(category_code)]), len(self.codes) + 1, self.version)


def models_ready(params: Params) -> bool:
    """True only when both model folders hold safetensors weights and torch can be imported.
    The API image has no torch, so there this is always False and the worker does the scoring."""
    for name in (params.ml.clip_model, params.ml.text_encoder):
        if not any(local_dir(name).rglob("*.safetensors")):
            return False
    try:
        import torch  # noqa: F401
        import sentence_transformers  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True


_SCORERS: dict[tuple[str, str], object] = {}


def text_scorer(params: Params) -> TextScorer:
    """Load once per worker process (and per config file)."""
    key = ("text", params.config_hash)
    if key not in _SCORERS:
        _SCORERS[key] = TextScorer(params)
    return _SCORERS[key]  # type: ignore[return-value]


def image_scorer(params: Params) -> ImageScorer:
    key = ("image", params.config_hash)
    if key not in _SCORERS:
        _SCORERS[key] = ImageScorer(params)
    return _SCORERS[key]  # type: ignore[return-value]
