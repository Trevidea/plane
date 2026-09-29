import unittest
import importlib.util
from pathlib import Path

module_path = Path(__file__).resolve().parents[3] / "utils" / "coaching_card_stages.py"
spec = importlib.util.spec_from_file_location("coaching_card_stages", module_path)
stages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stages)
build_stage_config = stages.build_stage_config
next_stage_id = stages.next_stage_id


class CoachingCardStageTests(unittest.TestCase):
    def test_config_uses_stable_ids_and_order(self):
        config = build_stage_config(
            "Basketball",
            [
                {"id": "b", "name": "Practice Plan", "sequence": 2},
                {"id": "a", "name": "New", "sequence": 1},
            ],
        )
        self.assertEqual(config["initial_stage_id"], "a")
        self.assertEqual([stage["id"] for stage in config["stages"]], ["a", "b"])
        self.assertEqual(config["stages"][0]["allowed_next_stage_ids"], ["b"])
        self.assertEqual(config["stages"][1]["abbreviation"], "PP")
        self.assertEqual(next_stage_id(config, "a"), "b")
        self.assertIsNone(next_stage_id(config, "b"))

    def test_invalid_configuration_is_rejected(self):
        with self.assertRaises(ValueError):
            build_stage_config("", [{"id": "a", "name": "New", "sequence": 1}])
        with self.assertRaises(ValueError):
            build_stage_config(
                "Basketball", [{"id": "a", "name": "New", "sequence": 1}, {"id": "a", "name": "Done", "sequence": 2}]
            )
        with self.assertRaises(ValueError):
            build_stage_config("Basketball", [])


if __name__ == "__main__":
    unittest.main()
