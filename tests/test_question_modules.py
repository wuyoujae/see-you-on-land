"""Verify curriculum alignment, Guangdong coverage and honest source gaps."""
import importlib.util
import copy
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


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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

    def test_all_four_course_subjects_have_a_reviewed_module(self):
        for sid in ('reasoning','quantity','language','analysis'):
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
            classifier=load_module(sid+'_test',f'scripts/question_modules/{sid}.py')
            for question in values:
                with self.subTest(question=question['id']):
                    self.assertEqual(question['classification'],classifier.classify(question))
                    self.assertEqual(question['topicId'],question['classification']['topicId'])
                    self.assertTrue(question['classification']['evidence'])

    def test_new_or_changed_language_and_analysis_questions_require_review(self):
        for sid in ('language','analysis'):
            classifier=load_module(sid+'_strict_test',f'scripts/question_modules/{sid}.py')
            original=QUESTIONS[sid][0]
            unknown=copy.deepcopy(original)
            unknown['id']='new-question-requiring-review'
            changed=copy.deepcopy(original)
            changed['stem']+='（修改后的题目）'
            for question in (unknown,changed):
                with self.subTest(subject=sid,question=question['id']):
                    with self.assertRaises(ValueError):
                        classifier.classify(question)

    def test_rebuilding_modules_preserves_question_content_and_matches_saved_data(self):
        builder=load_module('module_builder_test','scripts/build_question_modules.py')
        summary=builder.build(check=True)
        self.assertEqual(summary['language']['questionCount'],934)
        self.assertEqual(summary['analysis']['questionCount'],613)
        for sid in ('language','analysis'):
            values=copy.deepcopy(QUESTIONS[sid])
            before=copy.deepcopy(values)
            builder.classify_subject(sid,values,COURSES[sid])
            self.assertEqual(values,before)
            # A bad final row must not partially update the earlier rows.
            values[0].pop('topicId')
            values[0].pop('classification')
            values[-1]['id']='unreviewed-final-question'
            before=copy.deepcopy(values)
            with self.assertRaises(ValueError):
                builder.classify_subject(sid,values,COURSES[sid])
            self.assertEqual(values,before)

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

    def test_language_uses_question_intent_instead_of_option_length_or_numbering(self):
        lookup={q['id']:q for q in QUESTIONS['language']}
        expected={
            'national-2014-unified-q038':'language-logical-fill',  # Three long idioms are still word selection.
            'guangdong-qid-12881903':'language-logical-fill',
            'national-qid-2028464':'language-sentence-fill',  # Numbered insertion positions, not sentence ordering.
            'national-qid-2028470':'language-detail',  # A numbered combination of facts.
            'national-qid-2028472':'language-expository',  # Main idea depends on the accompanying passage.
            'national-qid-19283824':'language-news',  # Past-to-present development.
            'national-qid-5893825':'language-argumentative',  # Past-to-present evidence supports an opening argument.
        }
        for id_,topic in expected.items():
            self.assertEqual(lookup[id_]['topicId'],topic,id_)
        self.assertEqual(lookup['guangdong-qid-12881914']['classification']['courseLessonId'],'language-p1-l04')
        self.assertEqual(next(m for m in SUBJECTS['language']['modules'] if m['id']=='language-main-idea-basics')['questionCount'],0)

    def test_analysis_uses_calculation_goal_and_curriculum_boundaries(self):
        lookup={q['id']:q for q in QUESTIONS['analysis']}
        expected={
            'national-2014-unified-q116':'analysis-comparison',  # Rank growth rates.
            'national-2014-unified-q132':'analysis-share',  # Difference between two shares.
            'national-2014-unified-q133':'analysis-comparison',  # Rank shares across years.
            'national-2014-unified-q135':'analysis-comprehensive',
            'national-2015-municipal-q111':'analysis-abrx',  # Per-capita figures already given; calculate growth.
            'national-qid-1746788':'analysis-average',  # Calculate growth of a constructed average.
            'national-qid-5445745':'analysis-comparison',  # Rank annual growth, not calculate it.
            'national-qid-19526443':'analysis-mixture',  # Weighted quarterly/monthly growth.
            'guangdong-qid-2374830':'analysis-average',  # Average annual flows, not average growth.
            'guangdong-qid-2185042':'analysis-annual',
            'guangdong-qid-5514966':'analysis-mixture',  # Infer population weights from income averages.
            'guangdong-qid-12019685':'analysis-basic',
        }
        for id_,topic in expected.items():
            self.assertEqual(lookup[id_]['topicId'],topic,id_)
        for module in SUBJECTS['analysis']['modules']:
            if module['id'] in ('analysis-comprehensive','analysis-basic'):
                self.assertTrue(module['supplemental'])
                self.assertNotIn('courseGroupId',module)

    def test_no_missing_question_or_image_placeholders_are_shipped_as_questions(self):
        for values in QUESTIONS.values():
            for question in values:
                face=json.dumps({key:question.get(key) for key in ('stem','stemBlocks','options','materialBlocks')},ensure_ascii=False)
                for placeholder in ('题目正在全力以赴征集','原图待核','原图路径待核','材料2缺失'):
                    self.assertNotIn(placeholder,face,question['id'])


if __name__=='__main__':
    unittest.main()
