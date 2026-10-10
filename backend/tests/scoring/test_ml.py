"""Tests for profile B, evaluation metrics, the E7 scorer and the synthetic experiments."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.ml import metrics as M
from app.ml.profile_b import fit_profile_b
from app.ml.simulate import false_alarm_rate, price_pumping, sybil_attack, vote_ring
from app.scoring.beta import SUPPORTIVE
from app.scoring.params import load_params
from scripts.e7_encoder_selection import evaluate, read_samples

P = load_params()


class ProfileBTests(unittest.TestCase):
    def test_weights_non_negative_and_informative(self):
        rng = np.random.default_rng(0)
        rows, labels = [], []
        for _ in range(400):
            y = int(rng.random() < 0.5)
            comm = float(np.clip(0.5 + (0.35 if y else -0.35) + rng.normal(0, 0.1), 0, 1))
            noise = float(rng.random())
            rows.append({"community": comm, "text": noise, "gps": 1.0, "image": None})
            labels.append(y)
        fit = fit_profile_b(rows, labels)
        self.assertTrue(all(w >= 0 for w in fit.weights.values()))
        self.assertGreater(fit.weights["community"], fit.weights["text"])
        self.assertEqual(fit.weights["image"], 1.0)  # never available -> gradient 0 -> stays at start

    def test_one_class_rejected(self):
        with self.assertRaises(ValueError):
            fit_profile_b([{"text": 0.6}, {"text": 0.7}], [1, 1])


class MetricTests(unittest.TestCase):
    def test_macro_f1_and_kappa(self):
        t = ["supported", "uncertain", "not_supported", "strongly_supported"]
        self.assertAlmostEqual(M.macro_f1(t, t), 1.0)
        self.assertAlmostEqual(M.cohen_kappa(t, t), 1.0)

    def test_calibration(self):
        self.assertAlmostEqual(M.ece([1.0, 1.0, 0.0, 0.0], [1, 1, 0, 0]), 0.0)
        self.assertAlmostEqual(M.brier([0.5, 0.5], [1, 0]), 0.25)

    def test_risk_coverage_sorted_by_uncertainty(self):
        curve = M.risk_coverage([0.1, 0.9, 0.2], [1, 0, 1])
        self.assertEqual(curve[1], (2 / 3, 1.0))
        self.assertAlmostEqual(curve[-1][1], 2 / 3)

    def test_mape_and_ranks(self):
        self.assertEqual(M.mae_mape([110], [100]), (10.0, 10.0))
        self.assertAlmostEqual(M.kendall_tau(["a", "b", "c"], ["a", "b", "c"]), 1.0)
        self.assertEqual(M.top_k_overlap(["a", "b", "c"], ["b", "a", "d"], 2), 1.0)


class E7Tests(unittest.TestCase):
    def test_counts_per_style(self):
        rows = [{"text": "x", "category": "garbage", "style": "english"},
                {"text": "y", "category": "drainage", "style": "bangla"}]
        res = evaluate(lambda text: "garbage", rows)
        self.assertEqual((res["correct"], res["total"]), (1, 2))
        self.assertEqual(res["per_style"]["bangla"]["correct"], 0)

    def test_bad_category_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "s.csv"
            path.write_text("text,category,style\nhello,flood,english\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                read_samples(path, {c.code for c in P.categories})


class SimulationTests(unittest.TestCase):
    def test_sybil_layers(self):
        self.assertNotIn(sybil_attack(20, P, "all"), SUPPORTIVE)
        self.assertIn(sybil_attack(20, P, "none"), SUPPORTIVE)

    def test_ring_needs_spoofing(self):
        self.assertNotIn(vote_ring(8, 2, P, gps_spoofed=False), SUPPORTIVE)

    def test_median_resists_minority(self):
        self.assertLess(abs(price_pumping(6, 3, P)["shift_percent"]), 5)

    def test_false_alarms_below_target(self):
        r = false_alarm_rate(P, overdispersed=False, guard=True, wards=3, categories=3, days=80)
        self.assertLess(r["false_alarm_rate"], 0.05)


if __name__ == "__main__":
    unittest.main()
