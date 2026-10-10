"""Scoring engine tests. The worked example is copied from the spec (§1 "Worked example"),
so these tests fail if the code drifts from the approved formulas."""
import dataclasses
import unittest

from app.scoring import beta as B
from app.scoring.components import (
    ComponentResult, PastReport, Vote, chance_anchored, community_civic_component, gps_civic_component,
    history_component, image_component, metadata_component, text_component, gps_price_component,
    community_price_component,
)
from app.scoring.engine import CivicInputs, PriceInputs, score_civic, score_price, vote_key
from app.scoring.params import load_params

P = load_params()


def worked_example_inputs(votes=()):
    hist = history_component([PastReport(B.Status.SUPPORTED, 10)], P.history.half_life_days)
    return CivicInputs(
        text=text_component(0.55, 7),
        image=image_component(0.60, 8, P.flags.image_mismatch_threshold),
        gps=gps_civic_component(12, P.gps.accuracy_limit_m),
        metadata=metadata_component(90, P.metadata.capture_token_minutes),
        history_displayed=hist,
        history_judging=hist,
        reporter_rep=0.5,
        reporter_rep_u=1.0,
        votes=tuple(votes),
    )


def two_on_spot_one_far():
    return [
        Vote("v1", "d1", "on_spot", "confirm", 5, 1),
        Vote("v2", "d2", "on_spot", "confirm", 5, 1),
        Vote("v3", "d3", "far_away", "confirm", 3, 1),
    ]


class BetaBasics(unittest.TestCase):
    def test_prior_has_full_uncertainty(self):
        self.assertAlmostEqual(B.uncertainty(1, 1), 1.0)
        self.assertAlmostEqual(B.credibility(1, 1), 0.5)

    def test_same_credibility_different_uncertainty(self):
        self.assertAlmostEqual(B.credibility(9, 1), B.credibility(90, 10))
        self.assertAlmostEqual(B.uncertainty(90, 10), 0.011, places=3)
        self.assertAlmostEqual(B.uncertainty(9, 1), 0.098, places=3)

    def test_half_score_adds_nothing(self):
        self.assertEqual(B.evidence(0.5, 1.0), (0.0, 0.0))
        self.assertEqual(B.evidence(1.0, 1.0), (1.0, 0.0))
        self.assertEqual(B.evidence(0.0, 1.0), (0.0, 1.0))

    def test_score_out_of_range_rejected(self):
        with self.assertRaises(ValueError):
            B.evidence(1.2, 1.0)

    def test_chance_maps_to_half(self):
        self.assertAlmostEqual(chance_anchored(1 / 7, 7), 0.5)
        self.assertAlmostEqual(chance_anchored(1.0, 7), 1.0)
        self.assertAlmostEqual(chance_anchored(0.0, 7), 0.0)

    def test_conflict_from_split_votes(self):
        # 50 agree / 50 disagree looks certain without the conflict check (C2)
        self.assertGreaterEqual(B.conflict(2, 2, 50, 50), P.status.conflict_threshold)


class WorkedExample(unittest.TestCase):
    def test_step1_new_report(self):
        r = score_civic(worked_example_inputs(), P)
        d = r.displayed
        self.assertAlmostEqual(d.alpha, 4.152, places=2)
        self.assertAlmostEqual(d.beta, 1.0)
        self.assertAlmostEqual(d.credibility, 0.806, places=3)
        self.assertAlmostEqual(d.uncertainty, 0.305, places=3)
        # Supported by rule 3, but the gate makes it Uncertain (no corroboration, new reporter)
        self.assertEqual(d.status, B.Status.UNCERTAIN)
        self.assertTrue(d.gate_applied)
        self.assertNotIn("requires_more_verification", r.flags)
        self.assertEqual(d.components_used, 6)

    def test_step2_three_votes(self):
        r = score_civic(worked_example_inputs(two_on_spot_one_far()), P)
        d = r.displayed
        self.assertAlmostEqual(d.alpha, 4.574, places=2)
        self.assertAlmostEqual(d.credibility, 0.821, places=3)
        self.assertAlmostEqual(d.uncertainty, 0.269, places=3)
        self.assertEqual(d.status, B.Status.STRONGLY_SUPPORTED)

    def test_step3_reputation_outcomes(self):
        r = score_civic(worked_example_inputs(two_on_spot_one_far()), P)
        self.assertEqual(r.judging.status, B.Status.STRONGLY_SUPPORTED)
        self.assertEqual(r.reporter_outcome, "report_positive")
        # each on-spot voter has only 1 other on-spot vote (< k = 3): no change yet
        for v in two_on_spot_one_far()[:2]:
            self.assertIsNone(r.voter_outcomes[vote_key(v)])
        # far-away voters never earn voter reputation
        self.assertNotIn(vote_key(two_on_spot_one_far()[2]), r.voter_outcomes)

    def test_leave_one_out_values_match_spec(self):
        votes = two_on_spot_one_far()
        r = score_civic(worked_example_inputs([votes[1], votes[2]]), P)
        self.assertAlmostEqual(r.judging.credibility, 0.816, places=3)
        self.assertAlmostEqual(r.judging.uncertainty, 0.280, places=3)

    def test_voters_rewarded_from_fourth_on_spot_voter(self):
        votes = [Vote(f"v{i}", f"d{i}", "on_spot", "confirm", 5, 1) for i in range(4)]
        r = score_civic(worked_example_inputs(votes), P)
        self.assertTrue(all(o == "vote_agree" for o in r.voter_outcomes.values()))


class StatusRules(unittest.TestCase):
    def decide(self, c, u, kappa=0.0, corr=1, rep=None, rep_u=None, judging=False):
        return B.decide_status(c, u, kappa, P, corroborations=corr, reporter_rep=rep, reporter_rep_u=rep_u,
                               allow_reputation_gate=not judging).status

    def test_order(self):
        self.assertEqual(self.decide(0.9, 0.1, kappa=0.6), B.Status.UNCERTAIN)
        self.assertEqual(self.decide(0.75, 0.25), B.Status.STRONGLY_SUPPORTED)
        self.assertEqual(self.decide(0.6, 0.45), B.Status.SUPPORTED)
        self.assertEqual(self.decide(0.2, 0.3), B.Status.NOT_SUPPORTED)
        self.assertEqual(self.decide(0.4, 0.6), B.Status.UNCERTAIN)

    def test_gate(self):
        self.assertEqual(self.decide(0.75, 0.25, corr=0), B.Status.UNCERTAIN)
        self.assertEqual(self.decide(0.75, 0.25, corr=0, rep=0.8, rep_u=0.2), B.Status.STRONGLY_SUPPORTED)
        # judging status: reputation cannot open the gate (N4)
        self.assertEqual(self.decide(0.75, 0.25, corr=0, rep=0.8, rep_u=0.2, judging=True), B.Status.UNCERTAIN)

    def test_flags(self):
        self.assertTrue(B.needs_more_verification(0.4, 0.7, 0.0, P))
        self.assertFalse(B.needs_more_verification(0.8, 0.3, 0.0, P))
        self.assertTrue(B.should_auto_hide(8, True, 0.85, P))
        self.assertFalse(B.should_auto_hide(6, True, 0.85, P))


class Components(unittest.TestCase):
    def test_missing_is_not_zero(self):
        r = score_civic(CivicInputs(
            text=ComponentResult.unavailable("text", "x"), image=ComponentResult.unavailable("image", "x"),
            gps=gps_civic_component(10, 50), metadata=ComponentResult.unavailable("metadata", "x"),
            history_displayed=ComponentResult.unavailable("history", "x"),
            history_judging=ComponentResult.unavailable("history", "x"),
            reporter_rep=None, reporter_rep_u=None), P)
        self.assertAlmostEqual(r.displayed.beta, 1.0)  # unavailable components add no negative evidence
        self.assertEqual(r.displayed.components_used, 1)

    def test_gps_accuracy(self):
        self.assertAlmostEqual(gps_civic_component(100, 50).score, 0.75)
        inside = gps_price_component(10, 80, 150, 50).score
        outside = gps_price_component(10, 400, 150, 50).score
        self.assertAlmostEqual(inside, 1.0)
        self.assertAlmostEqual(outside, 0.0)
        self.assertEqual(gps_price_component(None, None, 150, 50).availability, "unavailable")

    def test_metadata_late_post_rejected(self):
        with self.assertRaises(ValueError):
            metadata_component(11 * 60, 10)
        self.assertAlmostEqual(metadata_component(600, 10).score, 0.5)

    def test_image_mismatch_flag(self):
        inputs = dataclasses.replace(worked_example_inputs(), image=image_component(0.05, 8, 0.5))
        r = score_civic(inputs, P)
        self.assertIn("category_mismatch", r.flags)

    def test_new_accounts_votes_weigh_zero(self):
        comp = community_civic_component([Vote("n", "d", "on_spot", "confirm", 1, 1)], [], P.votes.mode_weights)
        self.assertEqual(comp.availability, "unavailable")

    def test_fixed_now_not_counted(self):
        comp = community_civic_component([Vote("a", "d", "on_spot", "fixed_now", 5, 1)], [], P.votes.mode_weights)
        self.assertEqual(comp.availability, "unavailable")

    def test_price_scoring(self):
        comm = community_price_component(95, [(96, 0.8), (94, 0.8), (150, 0.8)], 0.25)
        self.assertTrue(comm.extra["corroborated"])
        r = score_price(PriceInputs(gps_price_component(None, None, 150, 50), metadata_component(60, 10), comm,
                                    0.5, 1.0, comm.extra["corroborated"]), P)
        self.assertEqual(r.displayed.rows[0].availability, "unavailable")  # text unused for prices
        self.assertGreater(r.displayed.credibility, 0.5)


if __name__ == "__main__":
    unittest.main()
