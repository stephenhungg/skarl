from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

EVALS = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("skarl_evaluation", EVALS / "evaluate.py")
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((EVALS / "manifest.example.json").read_text())
        self.predictions = json.loads((EVALS / "predictions.example.json").read_text())

    def test_wilson_small_samples_and_empty_denominator(self):
        for k, n, bounds in [(0, 15, [0, .204]), (0, 20, [0, .161]), (1, 15, [.012, .298])]:
            with self.subTest(k=k, n=n):
                for actual, expected in zip(MODULE.wilson(k, n), bounds):
                    self.assertAlmostEqual(actual, expected, delta=.0005)
        self.assertIsNone(MODULE.wilson(0, 0))
        self.assertEqual(MODULE.wilson(15, 15)[1], 1)
        for k, n in [(-1, 5), (6, 5), (1.5, 5), (True, 5)]:
            with self.assertRaises(ValueError):
                MODULE.wilson(k, n)

    def test_kappa_matrix_and_degenerate_cases(self):
        result = MODULE.criterion_agreement([("supported", "supported"), ("contradicted", "contradicted"),
                                             ("unobservable", "supported"), ("unobservable", "unobservable")])
        self.assertEqual(result["confusionMatrix"]["unobservable"]["supported"], 1)
        self.assertAlmostEqual(result["cohenKappa"], 7 / 11)
        self.assertIsNone(MODULE.criterion_agreement([])["cohenKappa"])
        self.assertIsNone(MODULE.criterion_agreement([("supported", "supported")])["cohenKappa"])

    def test_review_abstention_and_failed_analysis_do_not_earn_auto_decisions(self):
        self.predictions[0]["successfulAnalysis"] = False
        result = MODULE.score_predictions(self.manifest, self.predictions, "test")
        self.assertEqual(result["riskCoverage"], {"autoDecidedCount": 1, "errorCount": 0, "coverage": .25, "risk": 0})
        self.assertEqual(result["failureAdjustedDecisionAccuracy"], .5)
        self.assertEqual(result["criterionAgreement"]["count"], 9)
        self.assertEqual(MODULE.risk_coverage([("accept", "needs_review")], 1),
                         {"autoDecidedCount": 0, "errorCount": 0, "coverage": 0, "risk": None})

    def test_successful_analysis_flag_must_be_boolean(self):
        self.predictions[0]["successfulAnalysis"] = "false"
        with self.assertRaisesRegex(ValueError, "must be boolean"):
            MODULE.score_predictions(self.manifest, self.predictions, "test")

    def test_example_is_labeled_synthetic_without_inference(self):
        result = MODULE.score_predictions(self.manifest, self.predictions, "test")
        self.assertEqual(result["assessment"], "synthetic_plumbing_only")
        self.assertFalse(result["inferenceRan"])
        self.assertEqual(result["recommendations"]["correct"], 3)
        self.assertEqual(result["duplicates"]["perClass"]["suspected"]["falsePositive"], 1)

    def test_derivative_cannot_cross_splits(self):
        # Distinct actor and session, so only the shared origin recording can trip the check.
        derivative = self.manifest["samples"][1]
        derivative.update(split="test", actorId="derivative-actor", sessionId="derivative-session")
        with self.assertRaisesRegex(ValueError, "split leakage: originRecordingId"):
            MODULE.validate_manifest(self.manifest)

    def test_cosmetic_id_variants_cannot_cross_splits(self):
        test_sample = self.manifest["samples"][4]
        for key, value in (
            ("actorId", "example-actor-train "),
            ("sessionId", "EXAMPLE-SESSION-TRAIN"),
            ("originRecordingId", "example-origin-train-1\u200b"),
        ):
            manifest = deepcopy(self.manifest)
            manifest["samples"][4][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, f"split leakage: {key}"):
                MODULE.validate_manifest(manifest)
        self.assertEqual(test_sample["split"], "test")

    def test_shared_media_cannot_cross_splits(self):
        for key, value in (("mediaPath", "media/same.mp4"), ("contentSha256", "a" * 64)):
            manifest = deepcopy(self.manifest)
            manifest["samples"][0][key] = value
            manifest["samples"][4][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, f"split leakage: {key}"):
                MODULE.validate_manifest(manifest)

    def test_accept_must_be_consistent_with_its_labels(self):
        for change in ({"duplicateStatus": "suspected"}, {"criteria": {"object": "contradicted", "action": "supported", "narration": "supported"}}):
            predictions = deepcopy(self.predictions)
            predictions[0].update(change)
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "accept requires"):
                MODULE.score_predictions(self.manifest, predictions, "test")
            manifest = deepcopy(self.manifest)
            manifest["samples"][4]["expected"].update(change)
            with self.subTest(change=change, side="gold"), self.assertRaisesRegex(ValueError, "accept requires"):
                MODULE.validate_manifest(manifest)

    def test_actor_cannot_cross_splits(self):
        self.manifest["samples"][4]["actorId"] = "example-actor-train"
        with self.assertRaisesRegex(ValueError, "actorId"):
            MODULE.validate_manifest(self.manifest)

    def test_missing_hard_case_fails_coverage(self):
        self.predictions.pop()
        with self.assertRaisesRegex(ValueError, "coverage mismatch"):
            MODULE.score_predictions(self.manifest, self.predictions, "test")

    def test_duplicate_predictions_are_rejected(self):
        self.predictions.append(deepcopy(self.predictions[0]))
        with self.assertRaisesRegex(ValueError, "duplicate prediction"):
            MODULE.score_predictions(self.manifest, self.predictions, "test")

    def test_criterion_coverage_must_match(self):
        del self.predictions[0]["criteria"]["object"]
        with self.assertRaisesRegex(ValueError, "criterion coverage"):
            MODULE.score_predictions(self.manifest, self.predictions, "test")

    def test_non_synthetic_samples_require_media_references(self):
        self.manifest["syntheticMetadata"] = False
        with self.assertRaisesRegex(ValueError, "mediaPath"):
            MODULE.validate_manifest(self.manifest)


if __name__ == "__main__":
    unittest.main()
