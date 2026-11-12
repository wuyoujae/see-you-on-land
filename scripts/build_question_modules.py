"""Apply reviewed course modules to the existing bank without re-importing it.

All classifications are validated in memory before any runtime files are saved.
Question identity, content, answers, images and paper references are preserved.
"""
from __future__ import annotations

import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_SUBJECTS = ('reasoning', 'quantity', 'language', 'analysis')


def classify_subject(subject_id, questions, course_subject):
    if subject_id not in MODULE_SUBJECTS:
        raise ValueError('No reviewed module classifier for ' + subject_id)
    path = ROOT / 'scripts/question_modules' / (subject_id + '.py')
    spec = importlib.util.spec_from_file_location(subject_id + '_modules', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    definitions = module.module_definitions(course_subject)
    ids = [row['id'] for row in definitions]
    if len(set(ids)) != len(ids) or any(not id_.startswith(subject_id + '-') for id_ in ids):
        raise ValueError('Invalid or duplicate module IDs for ' + subject_id)
    courses = {group['id']: group for group in course_subject['groups']}
    for definition in definitions:
        group_id = definition.get('courseGroupId')
        if group_id and (group_id not in courses or definition['title'] != courses[group_id]['title']):
            raise ValueError('Module course link/title does not match: ' + definition['id'])
    counts = Counter()
    assignments = []
    for question in questions:
        if question['subjectId'] != subject_id:
            raise ValueError('Question belongs to another subject: ' + question['id'])
        classification = module.classify(question)
        if classification.get('topicId') not in ids or not classification.get('method') or not classification.get('evidence'):
            raise ValueError('Incomplete reviewed classification: ' + question['id'])
        counts[classification['topicId']] += 1
        assignments.append(classification)
    # Do not leave even the in-memory subject partly classified on a failure.
    for question, classification in zip(questions, assignments):
        question['topicId'] = classification['topicId']
        question['classification'] = classification
    return [{**definition, 'questionCount': counts[definition['id']]} for definition in definitions]


def build(subject_ids=MODULE_SUBJECTS, *, check=False):
    manifest_path = ROOT / 'data/question-bank/manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf8'))
    courses = {subject['id']: subject for subject in json.loads((ROOT / 'data/courses/manifest.json').read_text(encoding='utf8'))['subjects']}
    pending = {}
    summary = {}
    for subject in manifest['subjects']:
        sid = subject['id']
        if sid not in subject_ids:
            continue
        path = ROOT / 'data/question-bank/subjects' / (sid + '.json')
        data = json.loads(path.read_text(encoding='utf8'))
        if subject['questionIds'] != [q['id'] for q in data['questions']] or subject['questionCount'] != len(data['questions']):
            raise ValueError('Subject index differs from its question data: ' + sid)
        subject['modules'] = classify_subject(sid, data['questions'], courses[sid])
        pending[path] = data
        summary[sid] = {'questionCount': len(data['questions']), 'moduleCount': len(subject['modules'])}
    if set(summary) != set(subject_ids):
        raise ValueError('Requested subject is missing from the bank')
    pending[manifest_path] = manifest
    for path, value in pending.items():
        content = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
        if path.read_text(encoding='utf8') != content:
            if check:
                raise ValueError('Module data needs rebuilding: ' + str(path.relative_to(ROOT)))
            path.write_text(content, encoding='utf8')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subjects', nargs='+', choices=MODULE_SUBJECTS, default=MODULE_SUBJECTS)
    parser.add_argument('--check', action='store_true', help='Validate reviewed module data without writing files')
    args = parser.parse_args()
    print(json.dumps(build(args.subjects, check=args.check), ensure_ascii=False))
