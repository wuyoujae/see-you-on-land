"""Regression checks for the independently verified 2014 material boundaries."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('material_repair', ROOT / 'scripts/repair_question_materials.py')
REPAIR = importlib.util.module_from_spec(spec)
spec.loader.exec_module(REPAIR)
CURRENT = json.loads((ROOT / 'data/question-bank/subjects/analysis.json').read_text(encoding='utf8'))['questions']


def original_broken_materials():
    values = copy.deepcopy(CURRENT)
    lookup = {question['id']: question for question in values}
    for number in (*range(116, 126), *range(131, 136)):
        question = lookup[f'national-2014-unified-q{number}']
        question.pop('materialId')
        question.pop('materialBlocks')
    first = lookup['national-2014-unified-q126']
    lookup['national-2014-unified-q131'].update(
        materialId=first['materialId'], materialBlocks=copy.deepcopy(first['materialBlocks']))
    return values


class MaterialRepairTests(unittest.TestCase):
    def test_original_material_bug_is_repaired_without_altering_questions_or_answers(self):
        values = original_broken_materials()
        self.assertEqual(REPAIR.apply_material_patches(values)['patched'], 15)
        self.assertEqual(values, CURRENT)
        self.assertEqual(REPAIR.apply_material_patches(values)['alreadyApplied'], 15)
        self.assertEqual(values, CURRENT)

    def test_content_change_is_rejected_before_any_other_question_is_repaired(self):
        values = original_broken_materials()
        next(q for q in values if q['id'] == 'national-2014-unified-q135')['stem'] += ' changed'
        before = copy.deepcopy(values)
        with self.assertRaises(ValueError):
            REPAIR.apply_material_patches(values)
        self.assertEqual(values, before)


if __name__ == '__main__':
    unittest.main()
