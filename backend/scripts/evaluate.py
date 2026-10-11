"""Evaluation on the frozen export from `python -m app.cli export-eval` (spec §4). Real pilot data only.

    python -m scripts.evaluate report      --data exports/eval-v1.csv            # E1 + E2 on the test split
    python -m scripts.evaluate ablation    --data exports/eval-v1.csv            # E3 (simplified, see below)
    python -m scripts.evaluate fit-profile-b --data exports/eval-v1.csv          # F30 weights from the validation split
    python -m scripts.evaluate tune-tau    --data exports/eval-v1.csv            # B6 text temperature (needs the models)

Thresholds, τ and profile B are fitted on the validation split only; the test split is read once at the end (Q7, P4).
The binary target y = "final label is Supported or Strongly Supported" (open parameter B9) unless --target issue.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

from app.ml.metrics import STATUSES, brier, confusion, ece, macro_f1, per_class, risk_coverage
from app.scoring.params import COMPONENTS, load_params

SUPPORTIVE = {"supported", "strongly_supported"}


def load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise SystemExit(f"{path} has no rows")
    for r in rows:
        if r.get("status") == "pending":
            raise SystemExit("export contains pending reports; re-export after scoring finished")
    return rows


def scores(row: dict) -> dict[str, float | None]:
    return {k: (float(row[f"{k}_score"]) if row.get(f"{k}_score") not in ("", None) else None) for k in COMPONENTS}


def target(row: dict, kind: str) -> int:
    return int(row["issue_present"] == "yes") if kind == "issue" else int(row["final_label"] in SUPPORTIVE)


def threshold_status(c: float, params) -> str:
    st = params.status
    if c >= st.strongly_supported.min_credibility:
        return "strongly_supported"
    if c >= st.supported.min_credibility:
        return "supported"
    if c < st.not_supported_max_credibility:
        return "not_supported"
    return "uncertain"


def fused(row: dict, params, drop: str | None = None, weights: dict[str, float] | None = None) -> tuple[float, float]:
    """F3–F4 from the stored component scores (no gate, no conflict)."""
    w = weights or params.evidence.weights()
    a = b = 1.0
    for k, s in scores(row).items():
        if s is None or k == drop:
            continue
        a += w[k] * max(0.0, 2 * s - 1)
        b += w[k] * max(0.0, 1 - 2 * s)
    n = a + b
    return a / n, 12 * a * b / (n * n * (n + 1))


def baselines(rows: list[dict], train: list[dict], params) -> dict[str, list[str]]:
    majority = Counter(r["final_label"] for r in train).most_common(1)[0][0]
    b1 = []
    for r in rows:
        agree, disagree = int(r["votes_confirm"]), int(r["votes_disagree"])
        b1.append("uncertain" if agree == disagree else "supported" if agree > disagree else "not_supported")
    b2 = []
    for r in rows:
        avail = [s for s in scores(r).values() if s is not None]
        b2.append(threshold_status(sum(avail) / len(avail), params) if avail else "uncertain")
    b3 = []
    for r in rows:
        s = scores(r)
        ev = [v for v in (s["text"], s["image"]) if v is not None]
        parts = [(0.30, s["reputation"]), (0.25, sum(ev) / len(ev) if ev else None), (0.20, s["gps"]),
                 (0.15, s["community"]), (0.10, s["history"])]
        b3.append(threshold_status(sum(w * (v if v is not None else 0.5) for w, v in parts), params))
    return {"B0_majority": [majority] * len(rows), "B1_community_only": b1, "B2_equal_average": b2, "B3_old_weighted_sum": b3}


def cmd_report(rows: list[dict], params, args) -> dict:
    test = [r for r in rows if r["split"] == args.split]
    train = [r for r in rows if r["split"] == "validation"] or test
    y = [r["final_label"] for r in test]
    pred = [r["status"] for r in test]
    out = {"n": len(test), "split": args.split, "civicpulse": {"macro_f1": macro_f1(y, pred), "per_class": per_class(y, pred),
                                                              "confusion": confusion(y, pred).tolist(), "labels": STATUSES}}
    out["baselines"] = {k: macro_f1(y, v) for k, v in baselines(test, train, params).items()}
    out["baselines"]["B4_without_gate"] = "re-score with status.gate_enabled: false in a copy of the config"
    correct = [target(r, args.target) for r in test]
    conf = [float(r["credibility"]) for r in test]
    out["e2"] = {"target": args.target, "ece": ece(conf, correct), "brier": brier(conf, correct),
                 "risk_coverage": risk_coverage([float(r["uncertainty"]) for r in test], correct)}
    return out


def cmd_ablation(rows: list[dict], params, args) -> dict:
    """E3, simplified: statuses rebuilt from stored component scores with F3–F4 and the c thresholds only
    (no gate, no conflict, no uncertainty bands), so the full model and each ablation are compared like for like."""
    test = [r for r in rows if r["split"] == args.split]
    y = [r["final_label"] for r in test]
    full = [threshold_status(fused(r, params)[0], params) for r in test]
    out = {"n": len(test), "full": macro_f1(y, full), "drop_one": {}}
    for k in COMPONENTS:
        out["drop_one"][k] = macro_f1(y, [threshold_status(fused(r, params, drop=k)[0], params) for r in test]) - out["full"]
    if params.evidence.weights_b:
        out["profile_b"] = macro_f1(y, [threshold_status(fused(r, params, weights=params.evidence.weights_b)[0], params)
                                        for r in test])
    return out


def cmd_fit_profile_b(rows: list[dict], params, args) -> dict:
    from app.ml.profile_b import fit_profile_b

    val = [r for r in rows if r["split"] == "validation"]
    fit = fit_profile_b([scores(r) for r in val], [target(r, args.target) for r in val])
    return {"n_validation": fit.n_samples, "converged": fit.converged, "log_loss": fit.log_loss, "intercept": fit.intercept,
            "weights_b": {k: round(v, 4) for k, v in fit.weights.items()},
            "next_step": "copy weights_b into config/civicpulse.yaml (evidence.weights_b) for the results chapter only"}


def cmd_tune_tau(rows: list[dict], params, args) -> dict:
    """B6: pick τ that minimises the log-loss of the chosen category on validation civic reports whose issue is
    present. Needs the text encoder in MODELS_DIR (run on the machine with the models)."""
    from app.ml.inference import TextScorer
    from app.scoring.components import softmax_probability

    val = [r for r in rows if r["split"] == "validation" and r["module"] == "civic" and r["issue_present"] == "yes"
           and r["description"].strip()]
    if not val:
        raise SystemExit("no validation civic reports with issue_present = yes")
    scorer = TextScorer(params)
    vecs = scorer.embed([r["description"] for r in val])
    idx = [scorer.codes.index(r["category"]) for r in val]
    best = None
    for tau in np.geomspace(0.005, 0.2, 30):
        ll = -np.mean([np.log(max(softmax_probability(v, scorer.prototypes, i, tau), 1e-12)) for v, i in zip(vecs, idx)])
        if best is None or ll < best[1]:
            best = (float(tau), float(ll))
    return {"n": len(val), "best_tau": round(best[0], 4), "log_loss": best[1], "model": scorer.version,
            "next_step": "set ml.text_temperature in config/civicpulse.yaml"}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m scripts.evaluate")
    ap.add_argument("command", choices=["report", "ablation", "fit-profile-b", "tune-tau"])
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--split", default="test", choices=["test", "validation"])
    ap.add_argument("--target", default="label", choices=["label", "issue"])
    ap.add_argument("--out", type=Path, help="also save the JSON result here")
    args = ap.parse_args(argv)
    params = load_params()
    rows = load(args.data)
    fn = {"report": cmd_report, "ablation": cmd_ablation, "fit-profile-b": cmd_fit_profile_b, "tune-tau": cmd_tune_tau}
    result = {"config_hash": params.config_hash, "data": str(args.data), **fn[args.command](rows, params, args)}
    text = json.dumps(result, indent=2, default=str)
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
