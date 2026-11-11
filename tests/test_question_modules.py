"""Verify curriculum alignment, Guangdong coverage and honest source gaps."""
import importlib.util
import json
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf8'))
MANIFEST = read('data/question-bank/manifest.json')
SUBJECTS = {s['id']:s for s in MANIFEST['subjects']}
QUESTIONS = {s['id']:read(s['path'])['questions'] for s in MANIFEST['subjects']}
COURSES = {s['id']:s for s in read('data/courses/manifest.json')['subjects']}


class QuestionModuleTests(unittest.TestCase):
    def test_ten_guangdong_years_and_variants_have_accountable_counts(self):
        expected = {f'guangdong-{y}-unified':100 for y in (2017,2018)}
        expected.update({f'guangdong-{y}-{v}':100 for y in range(2019,2024) for v in ('county','township')})
        expected.update({f'guangdong-{y}-unified':90 for y in range(2024,2027)})
        papers = {p['id']:p for p in MANIFEST['papers'] if p.get('examId')=='guangdong'}
        self.assertEqual(set(papers),set(expected))
        for id_, count in expected.items():
            p=read(papers[id_]['path'])
            self.assertEqual(p['expectedQuestionCount'],count)
            missing=p.get('missingQuestionNumbers',[])
            self.assertEqual(len(set(missing)),len(missing))
            self.assertEqual(p['questionCount']+len(missing),count)
            self.assertTrue(all(1<=n<=count for n in missing))
            if missing:
                self.assertTrue(p['coverageNotice'])
                self.assertTrue(p['coverageEvidence'])
                self.assertEqual(papers[id_]['coverageNotice'],p['coverageNotice'])
        self.assertEqual(MANIFEST['coverage']['missingQuestionCount'],sum(len(p.get('missingQuestionNumbers',[])) for p in papers.values()))
        self.assertEqual(MANIFEST['totals']['paperQuestionCount']+MANIFEST['coverage']['missingQuestionCount'],5435)

    def test_all_reasoning_and_quantity_questions_have_a_reviewed_module(self):
        for sid in ('reasoning','quantity'):
            meta=SUBJECTS[sid]
            modules={m['id']:m for m in meta['modules']}
            courses={g['id']:g for g in COURSES[sid]['groups']}
            self.assertTrue(set(courses)<=set(modules))
            for id_, group in courses.items():
                self.assertEqual(modules[id_]['title'],group['title'])
                self.assertEqual(modules[id_]['courseGroupId'],id_)
            values=QUESTIONS[sid]
            counts=Counter(q['topicId'] for q in values)
            self.assertTrue(set(counts)<=set(modules))
            self.assertEqual(sum(m['questionCount'] for m in modules.values()),len(values))
            for id_, module in modules.items():
                self.assertEqual(module['questionCount'],counts[id_])
            spec=importlib.util.spec_from_file_location(sid+'_test',ROOT/'scripts/question_modules'/f'{sid}.py')
            classifier=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(classifier)
            for question in values:
                with self.subTest(question=question['id']):
                    self.assertEqual(question['classification'],classifier.classify(question))
                    self.assertEqual(question['topicId'],question['classification']['topicId'])
                    self.assertTrue(question['classification']['evidence'])

    def test_upstream_mislabels_are_not_used_as_curriculum_classification(self):
        lookup={q['id']:q for q in QUESTIONS['reasoning']}
        expected={'guangdong-qid-2047880':'reasoning-patterns',
                  'guangdong-qid-2185116':'reasoning-analytical',
                  'guangdong-qid-2604272':'reasoning-truth',
                  'guangdong-qid-2606143':'reasoning-assumption'}
        for id_, topic in expected.items():
            self.assertEqual(lookup[id_]['topicId'],topic)
        science=[q for q in lookup.values() if q['topicId']=='reasoning-science']
        self.assertGreaterEqual(len(science),136)
        for q in science:
            if q['id'].startswith('guangdong-'):
                self.assertEqual(q['source']['sourceModuleId'],'common')
                self.assertEqual(q['source']['category'],'科学推理')

    def test_no_missing_question_or_image_placeholders_are_shipped_as_questions(self):
        for values in QUESTIONS.values():
            for question in values:
                face=json.dumps({key:question.get(key) for key in ('stem','stemBlocks','options','materialBlocks')},ensure_ascii=False)
                for placeholder in ('题目正在全力以赴征集','原图待核','原图路径待核','材料2缺失'):
                    self.assertNotIn(placeholder,face,question['id'])


if __name__=='__main__':
    unittest.main()
