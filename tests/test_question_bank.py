"""Validate the shipped national-exam corpus, independently of its importer."""
import json
import unittest
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / 'data/question-bank/manifest.json').read_text(encoding='utf-8'))
SUBJECTS = {row['id']: json.loads((ROOT / row['path']).read_text(encoding='utf-8'))['questions'] for row in MANIFEST['subjects']}
QUESTIONS = {question['id']: question for values in SUBJECTS.values() for question in values}
PAPERS = {row['id']: json.loads((ROOT / row['path']).read_text(encoding='utf-8')) for row in MANIFEST['papers']}

def objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)

class NationalQuestionBankTests(unittest.TestCase):
    def test_all_years_and_real_variants_have_full_paper_counts(self):
        expected = {'national-2014-unified': 135}
        for year in range(2015, 2027):
            expected[f'national-{year}-provincial'] = 135
            expected[f'national-{year}-municipal'] = 130
            if year >= 2022:
                expected[f'national-{year}-law-enforcement'] = 130
        self.assertEqual(set(PAPERS), set(expected))
        self.assertEqual(sum(expected.values()), 3965)
        for key, count in expected.items():
            self.assertEqual(len(PAPERS[key]['questionIds']), count, key)
            self.assertEqual(len(set(PAPERS[key]['questionIds'])), count, key)

    def test_six_broad_categories_and_all_indexes_match_actual_data(self):
        self.assertEqual(set(SUBJECTS), {'politics','common','language','quantity','reasoning','analysis'})
        self.assertEqual(len(QUESTIONS), sum(map(len, SUBJECTS.values())))
        for meta in MANIFEST['subjects']:
            values = SUBJECTS[meta['id']]
            self.assertEqual(meta['questionIds'], [question['id'] for question in values])
            self.assertEqual(meta['questionCount'], len(values))
            self.assertTrue(all(question['subjectId'] == meta['id'] for question in values))
        self.assertEqual(MANIFEST['totals']['paperCount'], len(PAPERS))
        self.assertEqual(MANIFEST['totals']['questionCount'], len(QUESTIONS))
        self.assertEqual(MANIFEST['totals']['paperQuestionCount'], 3965)

    def test_every_question_has_four_options_a_gradable_reference_and_provenance(self):
        for question in QUESTIONS.values():
            with self.subTest(question=question['id']):
                self.assertTrue(question['stem'].strip())
                self.assertEqual([option['value'] for option in question['options']], ['A','B','C','D'])
                answer = question['answer'] if isinstance(question['answer'], list) else [question['answer']]
                self.assertTrue(answer)
                self.assertTrue(all(value in 'ABCD' and len(value) == 1 for value in answer))
                self.assertEqual(question['sourceAnswer']['answer'], question['answer'])
                self.assertTrue(question['sourceAnswer']['explanationBlocks'])
                self.assertIn(urlparse(question['sourceAnswer']['url']).scheme, {'http','https'})
                self.assertNotIn('官方', question['sourceAnswer']['provider'])
                face = {key: question.get(key) for key in ('stemBlocks','materialBlocks','options')}
                self.assertNotIn('✅', json.dumps(face, ensure_ascii=False))

    def test_paper_membership_and_subject_counts_are_bidirectional(self):
        for paper in PAPERS.values():
            self.assertEqual(paper['subjectCounts'], dict(Counter(QUESTIONS[qid]['subjectId'] for qid in paper['questionIds'])))
            for qid in paper['questionIds']:
                self.assertTrue(any(ref['paperId'] == paper['id'] for ref in QUESTIONS[qid]['paperRefs']))
        for question in QUESTIONS.values():
            for ref in question['paperRefs']:
                self.assertIn(question['id'], PAPERS[ref['paperId']]['questionIds'])

    def test_every_question_material_option_and_solution_image_exists_locally(self):
        image_paths = set()
        for question in QUESTIONS.values():
            for block in objects(question):
                if block.get('type') != 'image':
                    continue
                src = block['src']
                self.assertTrue(src.startswith('assets/images/question-bank/'), src)
                image = (ROOT / src).resolve()
                self.assertTrue(image.is_relative_to(ROOT / 'assets/images/question-bank'), src)
                self.assertTrue(image.is_file() and image.stat().st_size > 0, src)
                image_paths.add(src)
        self.assertEqual(len(image_paths), MANIFEST['totals']['imageCount'])

    def test_disputed_sources_stay_explicit_and_never_overwrite_pdf_reference(self):
        expected = {'national-2014-unified-q006': ('D','A'), 'national-2014-unified-q019': ('A','C'), 'national-2014-unified-q094': ('B','C')}
        found = {qid for qid, question in QUESTIONS.items() if question.get('alternativeReferences')}
        self.assertEqual(found, set(expected))
        for qid, (selected, alternative) in expected.items():
            question = QUESTIONS[qid]
            self.assertEqual(question['answer'], selected)
            self.assertIn('不同参考答案', question['sourceAnswer']['notice'])
            self.assertIn(alternative, [ref['answer'] for ref in question['alternativeReferences']])
            self.assertTrue(all(ref['url'].startswith('https://') for ref in question['alternativeReferences']))

    def test_known_missing_and_misclassified_questions_are_repaired(self):
        self.assertIn('national-2022-provincial-q004-supplement', PAPERS['national-2022-provincial']['questionIds'])
        for qid in ('national-qid-5445878', 'national-qid-5893530'):
            self.assertEqual(QUESTIONS[qid]['subjectId'], 'quantity')
            self.assertFalse(QUESTIONS[qid].get('materialBlocks'))

if __name__ == '__main__':
    unittest.main()
