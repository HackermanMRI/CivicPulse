"""E8-lite: zero-shot CLIP check on the team's real photos.

    python -m scripts.e8_photo_check /data/research/e8/photos.csv

CSV columns: file, category, place, taken_at. The photo files sit in the same folder as the CSV.
This is a preliminary check, not the pilot E8: the labels are the photographers' own category choices.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

from app.scoring.params import load_params

REQUIRED = {"file", "category", "place", "taken_at"}
UNRELATED = "unrelated"


def read_rows(csv_path: Path, codes: set[str]) -> list[dict]:
    with csv_path.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows or not REQUIRED <= set(rows[0]):
        raise ValueError(f"{csv_path} needs columns {sorted(REQUIRED)}")
    for i, r in enumerate(rows, start=2):
        if r["category"] not in codes:
            raise ValueError(f"line {i}: unknown category {r['category']!r}")
        if not (csv_path.parent / r["file"]).is_file():
            raise ValueError(f"line {i}: photo {r['file']!r} not found")
    return rows


def load_photo(path: Path) -> Image.Image:
    """Same intake as an upload: check the file, fix rotation, re-encode, then read it back."""
    from app.services.photos import process_image

    jpeg, _w, _h, _bits = process_image(path.read_bytes())
    return Image.open(io.BytesIO(jpeg)).convert("RGB")


def class_probabilities(scorer, image: Image.Image, codes: list[str]) -> dict[str, float]:
    """probability() answers for one category per call, so ask for every category.
    The 'unrelated scene' class is whatever probability is left over."""
    probs = {c: scorer.probability(image, c).p_chosen for c in codes}
    probs[UNRELATED] = max(0.0, 1.0 - sum(probs.values()))
    return probs

def evaluate(results: list[dict]) -> dict:
    per_category = defaultdict(lambda: [0, 0])
    confusion = Counter()
    for r in results:
        per_category[r["category"]][0] += r["correct"]
        per_category[r["category"]][1] += 1
        if not r["correct"]:
            confusion[(r["category"], r["predicted"])] += 1
    hits = sum(r["correct"] for r in results)
    return {
        "correct": hits,
        "total": len(results),
        "accuracy": hits / len(results),
        "unrelated_predicted": sum(r["predicted"] == UNRELATED for r in results),
        "mean_p_labelled": sum(r["p_labelled"] for r in results) / len(results),
        "per_category": {c: {"correct": h, "total": n} for c, (h, n) in sorted(per_category.items())},
        "confusion": [{"labelled": a, "predicted": b, "count": n} for (a, b), n in confusion.most_common()],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", type=Path)
    ap.add_argument("--out", type=Path, default=Path("/data/exports/e8_photo_check.json"))
    args = ap.parse_args()

    params = load_params()
    codes = [c.code for c in params.categories]
    rows = read_rows(args.csv, set(codes))

    from app.ml.inference import ImageScorer

    scorer = ImageScorer(params)
    results = []
    for r in rows:
        probs = class_probabilities(scorer, load_photo(args.csv.parent / r["file"]), codes)
        predicted = max(probs, key=probs.get)
        results.append({
            "file": r["file"], "place": r["place"], "category": r["category"], "predicted": predicted,
            "p_labelled": round(probs[r["category"]], 4), "correct": predicted == r["category"],
        })

    summary = evaluate(results)
    print(f"CLIP zero-shot: {summary['correct']}/{summary['total']} ({summary['accuracy']:.0%}); "
          f"guessing would be 1 in {len(codes) + 1}")
    print(f"called 'ordinary scene': {summary['unrelated_predicted']}/{summary['total']}; "
          f"mean probability of the photographer's category: {summary['mean_p_labelled']:.2f}")
    for code, s in summary["per_category"].items():
        print(f"  {code}: {s['correct']}/{s['total']}")
    for c in summary["confusion"]:
        print(f"  wrong: {c['labelled']} -> {c['predicted']} x{c['count']}")

    record = {
        "model": scorer.version,
        "config_hash": params.config_hash,
        "csv_sha256": hashlib.sha256(args.csv.read_bytes()).hexdigest(),
        "summary": summary,
        "photos": results,
    }
    with args.out.open("x", encoding="utf-8") as fh:        # "x" refuses to overwrite an earlier run
        json.dump(record, fh, indent=2, ensure_ascii=False)
    print(f"saved {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())