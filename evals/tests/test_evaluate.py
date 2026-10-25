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

    def test_example_is_labeled_synthetic_without_inference(self):
        result = MODULE.score_predictions(self.manifest, self.predictions, "test")
        self.assertEqual(result["assessment"], "synthetic_plumbing_only")
        self.assertFalse(result["inferenceRan"])
        self.assertEqual(result["recommendations"]["correct"], 3)
        self.assertEqual(result["duplicates"]["perClass"]["suspected"]["falsePositive"], 1)

    def test_derivative_cannot_cross_splits(self):
        self.manifest["samples"][1]["split"] = "test"
        with self.assertRaisesRegex(ValueError, "split leakage"):
            MODULE.validate_manifest(self.manifest)

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
