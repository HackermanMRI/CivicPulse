"""Run the synthetic experiments E4, E5 and E10 and save JSON results.

    python -m scripts.run_simulations            # writes eval_results/synthetic_*.json
"""
from __future__ import annotations

import json
from pathlib import Path

from app.ml.simulate import feedback_loop, run_e4, run_e10
from app.scoring.params import load_params


def main() -> int:
    params = load_params()
    out = Path("eval_results")
    out.mkdir(exist_ok=True)
    results = {
        "note": "SYNTHETIC data only. Never mix with pilot results (spec §4).",
        "config_hash": params.config_hash,
        "e4_attacks": run_e4(params),
        "e5_feedback_loop": [feedback_loop(params, split=True), feedback_loop(params, split=False)],
        "e10_false_alarms": run_e10(params),
    }
    path = out / "synthetic_results.json"
    path.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    print(json.dumps(results, indent=2, default=str))
    print(f"saved {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
