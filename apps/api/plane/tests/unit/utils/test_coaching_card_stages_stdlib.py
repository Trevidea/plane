import unittest
import importlib.util
from pathlib import Path

module_path = Path(__file__).resolve().parents[3] / "utils" / "coaching_card_stages.py"
spec = importlib.util.spec_from_file_location("coaching_card_stages", module_path)
stages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stages)
build_stage_config = stages.build_stage_config
next_stage_id = stages.next_stage_id
validate_stage_transition = stages.validate_stage_transition


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
        self.assertEqual(config["stages"][1]["allowed_next_stage_ids"], ["a"])
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

    def coaching_config(self, reviewed="In Work"):
        return build_stage_config(
            "Football",
            [
                {"id": str(index), "name": name, "sequence": index}
                for index, name in enumerate(["Identified", "Assigned", reviewed, "Ready for Coach Review", "Resolved"])
            ],
        )

    def test_manual_transitions_are_adjacent_and_assigned_is_automatic(self):
        config = self.coaching_config()
        self.assertEqual(config["stages"][0]["allowed_next_stage_ids"], ["1"])
        self.assertEqual(config["stages"][1]["allowed_next_stage_ids"], ["0"])
        self.assertEqual(config["stages"][2]["allowed_next_stage_ids"], ["1", "3"])
        with self.assertRaisesRegex(ValueError, "automatic"):
            validate_stage_transition(config, "1", "2", ["player"], "")
        with self.assertRaisesRegex(ValueError, "automatic"):
            validate_stage_transition(config, "1", "4", ["player"], "")
        with self.assertRaisesRegex(ValueError, "One stage at a time"):
            validate_stage_transition(config, "2", "4", ["player"], "")
        validate_stage_transition(config, "2", "3", ["player"], "")

    def test_assignment_requires_recipients(self):
        config = self.coaching_config()
        with self.assertRaisesRegex(ValueError, "Assign at least one"):
            validate_stage_transition(config, "0", "1", [], "")
        validate_stage_transition(config, "0", "1", ["player"], "")

    def test_reopen_requires_reason_and_exactly_one_previous_stage(self):
        config = self.coaching_config()
        with self.assertRaisesRegex(ValueError, "reason is required"):
            validate_stage_transition(config, "4", "3", ["player"], "   ")
        with self.assertRaisesRegex(ValueError, "one stage at a time"):
            validate_stage_transition(config, "4", "0", ["player"], "Needs more work")
        validate_stage_transition(config, "4", "3", ["player"], "Needs more work")
        validate_stage_transition(config, "1", "0", ["player"], "Wrong recipient")

    def test_system_can_only_perform_automatic_review_transition(self):
        for name in ("In Work", "Player Reviewed"):
            config = self.coaching_config(name)
            validate_stage_transition(config, "1", "2", ["player"], "", is_system=True)
            with self.assertRaisesRegex(ValueError, "Only player review"):
                validate_stage_transition(config, "2", "3", ["player"], "", is_system=True)


if __name__ == "__main__":
    unittest.main()
