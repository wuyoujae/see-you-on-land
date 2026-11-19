"""Check the actual published supplemental bank and its audited assets."""
import hashlib
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'scripts/question_sources/focused'


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FocusedPracticeTests(unittest.TestCase):
    def test_runtime_matches_reviewed_data_and_does_not_replace_real_exams(self):
        builder = load('focused_build_test', ROOT / 'scripts/build_focused_practice.py')
        summary = builder.build(check=True)
        self.assertEqual({key: value['questions'] for key, value in summary.items()},
                         {'numbers': 120, 'figures': 144, 'calculation': 180})
        manifest = read(ROOT / 'data/question-bank/manifest.json')
        self.assertEqual(manifest['totals']['questionCount'], 3810)
        real_ids = {qid for subject in manifest['subjects'] for qid in subject['questionIds']}
        supplemental_ids = {qid for meta in manifest['practiceSets'] for qid in meta['questionIds']}
        self.assertFalse(real_ids & supplemental_ids)
        self.assertEqual(len(supplemental_ids), 444)
        for meta in manifest['practiceSets']:
            rows = read(ROOT / meta['path'])['questions']
            self.assertEqual(sum(module['questionCount'] for module in meta['modules']), len(rows))
            for question in rows:
                self.assertFalse(question['source']['isPastExam'])
                self.assertIn('非真题', question['source']['versionLabel'])
                self.assertNotIn('verification', question)
                self.assertNotIn('paperRefs', question)

    def test_numbers_use_exact_independent_rule_verification(self):
        verifier = load('numbers_verify_test', SOURCE / 'numbers/verify.py')
        result = verifier.verify_all(read(SOURCE / 'numbers.reviewed.json'))
        self.assertEqual(result['unresolved'], [])
        self.assertEqual(result['total'], 120)

    def test_calculation_checks_rendered_expressions_and_declared_rounding(self):
        verifier = load('calculation_verify_test', SOURCE / 'calculation/verify.py')
        result = verifier.verify_all(read(SOURCE / 'calculation.reviewed.json'))
        self.assertEqual(result['unresolved'], [])
        self.assertEqual(result['total'], 180)
        report = read(SOURCE / 'calculation/verification-report.json')
        self.assertEqual(report['sha256'], hashlib.sha256(
            (SOURCE / 'calculation.reviewed.json').read_bytes()).hexdigest())
        runtime = read(ROOT / 'data/question-bank/practice/calculation.json')['questions']
        for q in runtime:
            self.assertEqual(q['type'], 'fill')
            self.assertNotIn('options', q)
            self.assertEqual(q['sourceAnswer']['answer'], q['answer'])
            self.assertLess(len(q['stem']), 140)
            self.assertIn(q['answerFormat']['kind'], ('number', 'percent'))

    def test_published_figure_images_match_the_visually_audited_files(self):
        original = read(SOURCE / 'figures/asset-manifest.json')
        self.assertEqual(len(original), 600)
        for record in original:
            self.assertEqual(hashlib.sha256((ROOT / record['runtimeRef']).read_bytes()).hexdigest(), record['sha256'])
            svg = SOURCE / 'figures/svg' / Path(record['authorSource']).name
            self.assertEqual(hashlib.sha256(svg.read_bytes()).hexdigest(), record['authorSourceSha256'])
        adapted = read(SOURCE / 'omib/render-manifest.json')
        self.assertEqual(len(adapted), 120)
        for record in adapted:
            self.assertEqual((ROOT / record['output']).read_bytes(), (SOURCE / 'omib' / record['output']).read_bytes())
        self.assertEqual((ROOT / 'assets/vendor/open-matrices/LICENSE').read_bytes(), (SOURCE / 'omib/GPL-3.0.txt').read_bytes())
        rows = read(ROOT / 'data/question-bank/practice/figures.json')['questions']
        for q in rows[-24:]:
            self.assertEqual(q['source']['kind'], 'adapted-open')
            self.assertEqual(q['source']['license'], 'GPL-3.0')
            self.assertTrue(q['source']['sourceCodeUrl'].endswith('/omib'))
            self.assertTrue(q['source']['adaptationNote'])

    def test_calculation_rejects_wrong_worked_arithmetic_even_with_a_new_hash(self):
        verifier = load('calculation_teaching_negative_test', SOURCE / 'calculation/verify.py')
        question = read(SOURCE / 'calculation.reviewed.json')[0]
        proof = question['verification']['teaching']
        old = proof['identities'][0]['text']
        proof['identities'][0]['text'] = old.split('＝')[0] + '＝999'
        for block in question['explanationBlocks']:
            block['text'] = block['text'].replace(old, proof['identities'][0]['text'])
        proof['explanationSha256'] = hashlib.sha256(json.dumps(
            question['explanationBlocks'], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        with self.assertRaises(AssertionError):
            verifier.verify_teaching(question)

    def test_calculation_rejects_wrong_residuals_and_unsafe_approximation_bounds(self):
        verifier = load('calculation_rounding_negative_test', SOURCE / 'calculation/verify.py')
        questions = read(SOURCE / 'calculation.reviewed.json')
        questions[84]['verification']['teaching']['division']['remainder'] = '0'
        questions[153]['verification']['teaching']['approximation']['roundingUpper'] = '3900'
        for question in (questions[84], questions[153]):
            with self.subTest(id=question['id']), self.assertRaises(AssertionError):
                verifier.verify_teaching(question)

    def test_teaching_regeneration_is_repeatable_and_preserves_problem_and_answer(self):
        teacher = load('calculation_teaching_test', SOURCE / 'calculation/teaching.py')
        questions = read(SOURCE / 'calculation.reviewed.json')
        originals = copy.deepcopy(questions)
        teacher.enrich_questions(questions)
        self.assertEqual(questions, originals)
        for question in questions:
            hint = question['verification'].pop('teaching')['originalHint']
            question['explanationBlocks'] = [{'type': 'paragraph', 'text': hint}]
        teacher.enrich_questions(questions)
        self.assertEqual(questions, originals)


if __name__ == '__main__':
    unittest.main()
