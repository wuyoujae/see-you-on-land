"""Merge traceable Guangdong provincial papers into the existing exam bank.

Raw downloads and interim audits live under tmp; --write publishes only after
all source questions, images, paper counts and reviewed modules are complete.
Existing national question IDs and practice progress remain stable.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
from pathlib import Path

import import_national_exams as base
from build_question_modules import MODULE_SUBJECTS, classify_subject
from repair_question_materials import apply_material_patches

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / 'tmp/guangdong_exam_research'
OUT = ROOT / 'data/question-bank'
COMMIT = '278984401124db40da5163a31275b8deb9c282f4'


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def reviewed_source(name):
    # Checked-in review decisions are the reproducible default. Explicit
    # research files permit a fresh review before updating those snapshots.
    candidate = RESEARCH / name
    return candidate if candidate.is_file() else ROOT / 'scripts/question_sources' / name


def objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)


def variant(title):
    if '统一卷' in title or not any(v in title for v in ['县级卷', '乡镇卷']):
        return 'unified', '统一卷'
    return ('county', '县级卷') if '县级卷' in title else ('township', '乡镇卷')


def content_key(q):
    return json.dumps([q['stemBlocks'], q['options'], q.get('materialBlocks')], ensure_ascii=False, sort_keys=True)


def main():
    global RESEARCH
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--research-root', type=Path, default=RESEARCH)
    args = parser.parse_args()
    RESEARCH = args.research_root.resolve()
    base.RAW = RESEARCH / 'raw/ERRRC'
    source_index = load(ROOT / 'scripts/question_sources/guangdong-index.json')
    for entry in source_index['entries']:
        path = base.RAW / entry['path']
        if not path.is_file():
            raise ValueError('Run download_guangdong_exams.py first; missing ' + entry['path'])
        blob = path.read_bytes()
        if hashlib.sha1(b'blob ' + str(len(blob)).encode() + b'\0' + blob).hexdigest() != entry['sha']:
            raise ValueError('Source differs from pinned Git blob: ' + entry['path'])
    base.COMMIT = COMMIT
    base.variant_of = variant
    base.RECLASSIFIED_QIDS = {}
    manifest = load(OUT / 'manifest.json')
    questions = {q['id']: q for s in manifest['subjects'] for q in load(ROOT / s['path'])['questions'] if not q['id'].startswith('guangdong-')}
    # Re-importing only replaces Guangdong data; pre-existing national fields
    # and stable question IDs are not rebuilt from an upstream snapshot.
    papers = {p['id']: load(ROOT / p['path']) for p in manifest['papers'] if not p['id'].startswith('guangdong-')}
    issues, conflicts = [], []
    coverage_path = reviewed_source('coverage-gaps.json')
    coverage = {row['paperId']:row for row in load(coverage_path)} if coverage_path.exists() else {}
    science_path = reviewed_source('science-reclassification.json')
    science_refs = {(r['paperId'], str(r['qid'])): r for r in load(science_path)} if science_path.exists() else {}
    for sid, _, folder in base.SUBJECTS:
        for path in sorted((base.RAW / folder).glob('*.md')):
            if not re.match(r'20(?:1[7-9]|2[0-6])年广东省公务员录用考试', path.name):
                continue
            paper, values, errors = base.parse_md(path, sid, exam_id='guangdong', allow_judgement=True)
            issues.extend(errors)
            year = paper['year']
            p = papers.setdefault(paper['id'], {**paper, 'examId': 'guangdong', 'examTitle': '广东省考',
                'questionIds': [], 'sourceUrls': [], 'ordering': '按科目与来源模块内顺序编排；未冒充原卷全局题号',
                'expectedQuestionCount': 100 if year <= 2023 else 90})
            p['sourceUrls'].append(base.source_url(path))
            for q in values:
                q['source'].update(examId='guangdong', examTitle='广东省考')
                for ref in q['paperRefs']:
                    ref.update(examId='guangdong', examTitle='广东省考')
                if (p['id'], q['source']['qid']) in science_refs:
                    q['subjectId'] = 'reasoning'
                    q['source']['classificationNote'] = '按广东省考卷面模块归入判断推理的科学推理；保留上游常识判断定位。'
                    q['source']['category'] = '科学推理'
                    q['source']['classificationEvidence'] = science_refs[(p['id'], q['source']['qid'])]['basis']
                    q['source'].pop('moduleNumber', None)
                    for ref in q['paperRefs']:
                        ref.update(subjectId='reasoning', sourceModuleId=sid, sourceModuleNumber=ref.pop('moduleNumber'))
                if q['id'] in questions and content_key(q) != content_key(questions[q['id']]):
                    q['id'] += '-v' + hashlib.sha256(content_key(q).encode()).hexdigest()[:8]
                if q['id'] in questions:
                    old = questions[q['id']]
                    if old['answer'] != q['answer']:
                        conflicts.append({'id':q['id'], 'answers':[old['answer'], q['answer']]})
                    for ref in q['paperRefs']:
                        if ref not in old['paperRefs']:
                            old['paperRefs'].append(ref)
                else:
                    questions[q['id']] = q
                if q['id'] not in p['questionIds']:
                    p['questionIds'].append(q['id'])
    supplement = reviewed_source('supplemental-questions.json')
    if supplement.exists():
        supplemental_keys = {(q['subjectId'], content_key(q), json.dumps(q['answer'],ensure_ascii=False)):q['id'] for q in questions.values() if q['id'].startswith('guangdong-')}
        for q in load(supplement):
            if q['id'] in questions:
                raise ValueError('Supplement ID collides: ' + q['id'])
            q['source'].update(examId='guangdong', examTitle='广东省考')
            q['source'].setdefault('category', q['source'].get('sourceCategory', ''))
            key = (q['subjectId'], content_key(q), json.dumps(q['answer'],ensure_ascii=False))
            canonical_id = supplemental_keys.setdefault(key, q['id'])
            if canonical_id == q['id']:
                questions[q['id']] = q
            for ref in q['paperRefs']:
                ref.update(examId='guangdong', examTitle='广东省考')
                if ref not in questions[canonical_id]['paperRefs']:
                    questions[canonical_id]['paperRefs'].append(ref)
                p = papers[ref['paperId']]
                if canonical_id not in p['questionIds']:
                    p['questionIds'].append(canonical_id)
                p['sourceUrls'] += [q['source']['url'], q['sourceAnswer']['url']]
    apply_material_patches(list(questions.values()))
    grouped = {sid: [q for q in questions.values() if q['subjectId'] == sid] for sid, _, _ in base.SUBJECTS}
    for sid, values in grouped.items():
        base.dump(RESEARCH / 'merged' / (sid + '.json'), {'id':sid, 'questions':values})
    subject_records, paper_records = [], []
    for p in sorted(papers.values(), key=lambda row:(row['year'], row['id'])):
        p.setdefault('examId', 'national')
        p.setdefault('examTitle', '国考')
        if p['examId'] == 'guangdong':
            ranks = {sid:i for i,(sid,_,_) in enumerate(base.SUBJECTS)}
            p['questionIds'].sort(key=lambda qid:ranks[questions[qid]['subjectId']])
            p['ordering'] = '按科目及来源模块内顺序编排；补缺题位于对应科目末尾，不冒充原卷全局题号'
        p['questionCount'] = len(p['questionIds'])
        p['subjectCounts'] = dict(collections.Counter(questions[qid]['subjectId'] for qid in p['questionIds']))
        p['sourceUrls'] = list(dict.fromkeys(p.get('sourceUrls', [])))
        if p['examId'] == 'guangdong' and p['questionCount'] != p['expectedQuestionCount']:
            gap = coverage.get(p['id'], {})
            numbers = gap.get('missingQuestionNumbers', [])
            if gap.get('collectedCount') == p['questionCount'] and gap.get('expectedCount') == p['expectedQuestionCount'] and len(set(numbers)) == p['expectedQuestionCount'] - p['questionCount'] and gap.get('evidenceUrls'):
                p['missingQuestionNumbers'] = numbers
                p['coverageNotice'] = f"原卷 {p['expectedQuestionCount']} 题，当前收录 {p['questionCount']} 题。第 {'、'.join(map(str,numbers))} 题尚缺完整可核验来源，未计入可刷题量。"
                p['coverageEvidence'] = gap['evidenceUrls']
            else:
                issues.append({'paperId':p['id'], 'issue':'unaccounted_incomplete_paper', 'actual':p['questionCount'], 'expected':p['expectedQuestionCount']})
        paper_records.append({k:p[k] for k in ('id','title','year','variant','questionCount','subjectCounts','examId','examTitle','expectedQuestionCount','missingQuestionNumbers','coverageNotice') if k in p} | {'path':f"data/question-bank/papers/{p['id']}.json"})
    images = {o['src'] for q in questions.values() for o in objects(q) if o.get('type') == 'image'}
    missing_images = [p for p in images if not (ROOT / p).is_file()]
    audit = {'parseIssues':issues, 'answerConflicts':conflicts, 'missingImages':missing_images,
        'knownSourceGaps':[{k:v for k,v in row.items() if k!='localEvidence'} for row in coverage.values()],
        'papers':paper_records, 'guangdongUniqueQuestions':sum(q['id'].startswith('guangdong-') for q in questions.values()),
        'subjectCounts':{sid:len(qs) for sid,qs in grouped.items()}}
    base.dump(RESEARCH / 'import-audit.json', audit)
    print(json.dumps({k:v for k,v in audit.items() if k != 'papers'}, ensure_ascii=False))
    if not args.write:
        return
    if issues or conflicts or missing_images or base.missing_images:
        raise ValueError('Source completeness checks failed; runtime bank was not replaced.')
    courses = {s['id']:s for s in load(ROOT / 'data/courses/manifest.json')['subjects']}
    for sid, title, _ in base.SUBJECTS:
        values = grouped[sid]
        meta = {'id':sid, 'title':title, 'path':f'data/question-bank/subjects/{sid}.json', 'questionCount':len(values), 'questionIds':[q['id'] for q in values]}
        if sid in MODULE_SUBJECTS:
            meta['modules'] = classify_subject(sid, values, courses[sid])
        subject_records.append(meta)
    manifest.update(title='国考与广东省考行测真题', subjects=subject_records, papers=paper_records,
        exams=[{'id':'national','title':'国考','yearRange':[2014,2026]}, {'id':'guangdong','title':'广东省考','yearRange':[2017,2026]}],
        totals={'subjectCount':6, 'paperCount':len(papers), 'questionCount':len(questions), 'paperQuestionCount':sum(p['questionCount'] for p in papers.values()), 'imageCount':len(images)})
    manifest['coverage'] = {'expectedPaperQuestionCount':sum(p.get('expectedQuestionCount', p['questionCount']) for p in papers.values()),
        'missingQuestionCount':sum(p.get('expectedQuestionCount', p['questionCount']) - p['questionCount'] for p in papers.values()),
        'completePaperCount':sum(p.get('expectedQuestionCount', p['questionCount']) == p['questionCount'] for p in papers.values())}
    manifest['sources'] = [s for s in manifest.get('sources', []) if s['id'] != 'guangdong-supplements']
    if supplement.exists():
        manifest['sources'].append({'id':'guangdong-supplements', 'versionLabel':'广东省考公开整理与考生回忆资料；补缺题逐题留有来源', 'urls':sorted({q['source']['url'] for q in load(supplement)})})
    for s in subject_records:
        base.dump(ROOT / s['path'], {'id':s['id'], 'title':s['title'], 'questions':grouped[s['id']]})
    for p in papers.values():
        base.dump(OUT / 'papers' / (p['id'] + '.json'), p)
    base.dump(OUT / 'manifest.json', manifest)


if __name__ == '__main__':
    main()
