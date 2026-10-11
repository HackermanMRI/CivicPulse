"""Reputation, prices, hotspots, alerts, collusion and config tests."""
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from scipy import stats

from app.scoring import alerts as A
from app.scoring.beta import Status
from app.scoring.collusion import VoteRow, flag_pairs, pair_statistics
from app.scoring.hotspots import HotspotReport, find_hotspots
from app.scoring.params import default_config_path, load_params
from app.scoring.prices import CellReport, outlier_flags, price_alert, seven_day_change, verified_price, counts_toward_verified
from app.scoring.reputation import RepEvent, read_reputation, to_display

P = load_params()
NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)


class ReputationTests(unittest.TestCase):
    def test_spec_decay_example(self):
        # Beta(50,1) built 90 days ago keeps α = 25.5; after 20 recent bad results rep = 0.55
        old = [RepEvent("report_positive", 49, 0, NOW - timedelta(days=90))]
        self.assertAlmostEqual(read_reputation(old, NOW, P).alpha, 25.5, places=6)
        recent = [RepEvent("report_negative", 0, 1, NOW) for _ in range(20)]
        self.assertAlmostEqual(read_reputation(old + recent, NOW, P).rep, 0.548, places=3)

    def test_new_user(self):
        r = read_reputation([], NOW, P)
        self.assertEqual((r.alpha, r.beta, r.rep, r.belief), (1.0, 1.0, 0.5, 0.0))

    def test_display_conversion(self):
        self.assertEqual(to_display(0.824), 82)
        self.assertIsNone(to_display(None))


def cell(i, price, status=Status.SUPPORTED, user=None, device=None, dup=False, visible=True, c=0.8):
    return CellReport(f"r{i}", user or f"u{i}", device or f"d{i}", price, status, dup, visible, c)


class PriceTests(unittest.TestCase):
    def test_needs_three_eligible(self):
        v = verified_price([cell(1, 90), cell(2, 95)], P)
        self.assertEqual((v.status, v.value), ("Insufficient Evidence", None))
        v = verified_price([cell(1, 90), cell(2, 95), cell(3, 100)], P)
        self.assertEqual((v.status, v.value), ("Verified", 95.0))
        self.assertTrue(counts_toward_verified("r2", v))

    def test_ineligible_reports_ignored(self):
        reports = [cell(1, 90), cell(2, 95), cell(3, 100, status=Status.UNCERTAIN), cell(4, 99, dup=True),
                   cell(5, 98, visible=False), cell(6, 97, user="u1")]
        self.assertEqual(verified_price(reports, P).status, "Insufficient Evidence")

    def test_outliers_small_and_large_n(self):
        self.assertEqual(outlier_flags([90, 95, 100, 150], P), [False, False, False, True])
        flags = outlier_flags([95, 96, 94, 95, 97, 93, 95, 96, 200], P)
        self.assertEqual(flags[-1], True)
        self.assertEqual(sum(flags), 1)

    def test_seven_day_change_and_alert(self):
        today = date(2026, 10, 11)
        series = {date(2026, 10, 3): 70.0, date(2026, 10, 5): 85.0, date(2026, 10, 11): 95.0}
        ch = seven_day_change(series, today, P)
        self.assertEqual((ch.from_date, ch.to_date), (date(2026, 10, 5), today))  # 3 Oct is outside 7 days
        self.assertAlmostEqual(ch.percent, 11.76, places=2)
        self.assertEqual(price_alert(ch, P), "rise")
        self.assertIsNone(seven_day_change({today: 95.0}, today, P))


def hr(i, user, lat, lon, cat="waterlogging", day=date(2026, 10, 10), c=0.8, age=1):
    return HotspotReport(f"h{i}", user, cat, day, lat, lon, c, age)


class HotspotTests(unittest.TestCase):
    base = (23.6238, 90.5000)

    def test_cluster_found(self):
        lat, lon = self.base
        reports = [hr(1, "a", lat, lon), hr(2, "b", lat + 0.0002, lon), hr(3, "c", lat, lon + 0.0002)]
        hs = find_hotspots(reports, P)
        self.assertEqual(len(hs), 1)
        h = hs[0]
        self.assertEqual(h.n_reports, 3)
        self.assertAlmostEqual(h.s_severity, 0.87)
        self.assertGreater(h.score, 0)
        self.assertLessEqual(h.score, 100)

    def test_same_user_same_day_deduplicated(self):
        lat, lon = self.base
        reports = [hr(i, "a", lat + i * 0.0001, lon) for i in range(3)]
        self.assertEqual(find_hotspots(reports, P), [])

    def test_two_users_minimum(self):
        lat, lon = self.base
        reports = [hr(1, "a", lat, lon, day=date(2026, 10, 1)), hr(2, "a", lat, lon, day=date(2026, 10, 2)),
                   hr(3, "a", lat, lon, day=date(2026, 10, 3))]
        self.assertEqual(find_hotspots(reports, P), [])

    def test_unweighted_clustering(self):
        # Three real reports at credibility 0.8 must still cluster (the L10 sample_weight trap)
        lat, lon = self.base
        reports = [hr(1, "a", lat, lon, c=0.8), hr(2, "b", lat, lon, c=0.8), hr(3, "c", lat, lon, c=0.8)]
        self.assertEqual(len(find_hotspots(reports, P)), 1)


class AlertTests(unittest.TestCase):
    def test_c_test_matches_binomial(self):
        self.assertAlmostEqual(A.c_test_p(5, 28, 28), stats.binom.sf(4, 33, 1 / 29))

    def test_baseline_window_and_guard(self):
        t = date(2026, 10, 11)
        live = {t - timedelta(days=i) for i in range(0, 40)}
        counts = {t: 6, t - timedelta(days=1): 50, t - timedelta(days=2): 1}
        b = A.build_baseline(counts, live, t, P)
        self.assertEqual((b.observed, b.total, b.live_days), (6, 1, 28))  # the day before is the guard band

    def test_insufficient_history(self):
        t = date(2026, 10, 11)
        b = A.build_baseline({t: 9}, {t - timedelta(days=i) for i in range(2, 6)}, t, P)
        res = A.run_alerts({("w1", "garbage"): b}, t, P)
        self.assertEqual(res[0].test, "insufficient")
        self.assertFalse(res[0].alert)

    def test_spike_fires_and_quiet_does_not(self):
        t = date(2026, 10, 11)
        live = {t - timedelta(days=i) for i in range(0, 40)}
        quiet = {t - timedelta(days=i): (1 if i % 7 == 0 else 0) for i in range(2, 30)}
        spike = A.build_baseline({**quiet, t: 6}, live, t, P)
        normal = A.build_baseline({**quiet, t: 1}, live, t, P)
        res = {r.ward_id: r for r in A.run_alerts({("w1", "garbage"): spike, ("w2", "garbage"): normal}, t, P)}
        self.assertTrue(res["w1"].alert)
        self.assertFalse(res["w2"].alert)

    def test_negative_binomial_mean(self):
        # NB with dispersion φ keeps the mean λ̂; its tail is heavier than Poisson
        self.assertGreater(A.nb_p(6, 28, 28, 2.0), stats.poisson.sf(5, 28.5 / 28))


class CollusionTests(unittest.TestCase):
    def test_lockstep_pair_flagged(self):
        votes = []
        t0 = NOW
        for i in range(12):
            rid = f"r{i}"
            votes += [VoteRow("x", rid, "confirm", "on_spot", t0 + timedelta(hours=i)),
                      VoteRow("y", rid, "confirm", "on_spot", t0 + timedelta(hours=i, seconds=20)),
                      VoteRow(f"h{i}", rid, "disagree", "on_spot", t0 + timedelta(hours=i, minutes=30))]
        flags = flag_pairs(pair_statistics(votes), P)
        pairs = {(f.stats.user_a, f.stats.user_b) for f in flags}
        self.assertIn(("x", "y"), pairs)


class ConfigTests(unittest.TestCase):
    def test_hash_and_categories(self):
        self.assertEqual(len(P.config_hash), 64)
        self.assertEqual(len(P.categories), 7)

    def test_bad_value_fails(self):
        text = default_config_path().read_text(encoding="utf-8").replace("conflict_threshold: 0.5", "conflict_threshold: 1.5")
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "bad.yaml"
            path.write_text(text, encoding="utf-8")
            with self.assertRaises(Exception):
                load_params(path)


if __name__ == "__main__":
    unittest.main()
