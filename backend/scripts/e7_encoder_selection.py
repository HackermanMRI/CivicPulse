"""E7: choose the text encoder by top-1 category accuracy on the fixed 50 samples (P13).

    python -m scripts.e7_encoder_selection data/e7_samples.csv

CSV columns: text, category (one of the 7 codes), style (bangla | english | banglish).
Member B writes the file before any other use of the data. Results are reported
as raw counts and percentages, overall and per style.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

from app.scoring.params import load_params

REQUIRED = {"text", "category", "style"}


def read_samples(path: Path, codes: set[str]) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows or not REQUIRED <= set(rows[0]):
        raise ValueError(f"{path} needs columns {sorted(REQUIRED)}")
    for i, r in enumerate(rows, start=2):
        if r["category"] not in codes:
            raise ValueError(f"line {i}: unknown category {r['category']!r}")
        if not r["text"].strip():
            raise ValueError(f"line {i}: empty text")
    return rows


def evaluate(top1, rows: list[dict]) -> dict:
    """`top1(text) -> category code` so the scoring can be tested without a real model."""
    hits, per_style = 0, defaultdict(lambda: [0, 0])
    for r in rows:
        ok = top1(r["text"]) == r["category"]
        hits += ok
        per_style[r["style"]][0] += ok
        per_style[r["style"]][1] += 1
    return {
        "correct": hits, "total": len(rows), "accuracy": hits / len(rows),
        "per_style": {s: {"correct": c, "total": t, "accuracy": c / t} for s, (c, t) in per_style.items()},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("samples", type=Path)
    args = ap.parse_args()
    params = load_params()
    rows = read_samples(args.samples, {c.code for c in params.categories})
    if len(rows) != 50:
        print(f"warning: P13 fixes the set at exactly 50 samples, found {len(rows)}", file=sys.stderr)
    from app.ml.inference import TextScorer

    results = {}
    for cand in params.ml.encoder_candidates:
        scorer = TextScorer(params, cand.name, cand.query_prefix)
        res = evaluate(scorer.top1, rows)
        results[cand.name] = res
        print(f"{cand.name}: {res['correct']}/{res['total']} ({res['accuracy']:.0%})")
        for style, s in sorted(res["per_style"].items()):
            print(f"    {style}: {s['correct']}/{s['total']} ({s['accuracy']:.0%})")
    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
