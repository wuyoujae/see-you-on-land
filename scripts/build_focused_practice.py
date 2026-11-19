"""Publish reviewed non-exam exercises without modifying the real-exam bank."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('scripts/question_sources/focused')
SETS = (
    ('numbers', '数字规律专项', 'quantity', '#/study/quantity?topic=quantity-number-sequences'),
    ('figures', '图形推理专项', 'reasoning', '#/study/reasoning?topic=reasoning-figures'),
    ('calculation', '资料速算', 'analysis', '#/study/analysis'),
)
LEVELS = ('foundation', 'standard', 'challenge')
SOURCE_URL = 'https://github.com/wuyoujae/see-you-on-land/tree/main/scripts/question_sources/focused'


def read_json(path):
    return json.loads(path.read_text(encoding='utf8'))


def encoded(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'


def images(value):
    if isinstance(value, dict):
        if value.get('type') == 'image':
            yield value['src']
        for child in value.values():
            yield from images(child)
    elif isinstance(value, list):
        for child in value:
            yield from images(child)


def checked_images(question, root):
    paths = set(images(question))
    for relative in paths:
        if not re.fullmatch(r'assets/images/question-bank/focused/[a-zA-Z0-9_-]+\.png', relative):
            raise ValueError('Unsafe or unsupported image: ' + relative)
        path = root / relative
        if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
            raise ValueError('Image escapes the project: ' + relative)
        raw = path.read_bytes()
        if raw[:8] != b'\x89PNG\r\n\x1a\n' or len(raw) < 24:
            raise ValueError('Invalid PNG: ' + relative)
        width, height = struct.unpack('>II', raw[16:24])
        if min(width, height) < 100 or max(width, height) > 6000:
            raise ValueError('Unreadable image dimensions: ' + relative)
    return paths


def build(*, check=False, root=ROOT):
    root = Path(root)
    manifest_path = root / 'data/question-bank/manifest.json'
    manifest = read_json(manifest_path)
    occupied = {qid for subject in manifest['subjects'] for qid in subject['questionIds']}
    pending, metadata, summary = {}, [], {}
    for set_id, title, subject_id, exam_route in SETS:
        reviewed = read_json(root / SOURCE / (set_id + '.reviewed.json'))
        if not isinstance(reviewed, list) or not reviewed:
            raise ValueError('An empty or malformed collection cannot be published: ' + set_id)
        questions, modules, image_paths, seen_content = [], {}, set(), set()
        for number, row in enumerate(reviewed, 1):
            qid = row.get('id', '')
            if not re.fullmatch(r'focus-[a-z0-9-]+', qid) or qid in occupied:
                raise ValueError('Invalid or duplicated question ID: ' + qid)
            occupied.add(qid)
            if row.get('kind') != set_id or row.get('difficulty') not in LEVELS:
                raise ValueError('Invalid collection or difficulty: ' + qid)
            if row.get('verification', {}).get('status') != 'passed':
                raise ValueError('Independent verification is incomplete: ' + qid)
            skill_id, skill_title = row.get('skillId', ''), row.get('skillTitle', '')
            if not re.fullmatch(r'[a-z][a-z0-9-]+', skill_id) or not skill_title:
                raise ValueError('Missing exercise module: ' + qid)
            module = modules.setdefault(skill_id, {'id': skill_id, 'title': skill_title, 'questionCount': 0})
            if module['title'] != skill_title:
                raise ValueError('Inconsistent module title: ' + skill_id)
            module['questionCount'] += 1
            options = row.get('options', [])
            if [o.get('value') for o in options] != list('ABCD') or row.get('answer') not in tuple('ABCD'):
                raise ValueError('Expected four options and one answer: ' + qid)
            if not row.get('stem') or not row.get('explanationBlocks'):
                raise ValueError('Missing question or explanation: ' + qid)
            image_paths.update(checked_images(row, root))
            # Image option labels are just letters; compare their actual pixels.
            option_keys = []
            for option in options:
                content = list(images(option))
                option_keys.append(tuple(hashlib.sha256((root / p).read_bytes()).hexdigest() for p in content) if content else option.get('label', '').strip())
            if len(set(option_keys)) != 4 or any(not key for key in option_keys):
                raise ValueError('Duplicate or empty options: ' + qid)
            content_key = encoded([row['stem'], row.get('stemBlocks'), option_keys])
            if content_key in seen_content:
                raise ValueError('Duplicated exercise content: ' + qid)
            seen_content.add(content_key)
            provenance = row.get('provenance', {'kind': 'original-practice'})
            adapted = provenance.get('kind') == 'adapted-open'
            if adapted and not all(provenance.get(key) for key in ('provider', 'sourceUrl', 'license', 'licenseUrl', 'adaptationNote')):
                raise ValueError('Incomplete attribution: ' + qid)
            if provenance['kind'] not in ('original-practice', 'adapted-open'):
                raise ValueError('Unknown provenance: ' + qid)
            source = {
                **provenance, 'isPastExam': False, 'questionNumber': number,
                'versionLabel': '开放题库改编（非真题）' if adapted else '原创专项练习（非真题）',
                'url': provenance.get('sourceUrl', SOURCE_URL),
            }
            if adapted:
                source['sourceCodeUrl'] = SOURCE_URL + '/omib'
            stem_blocks = row.get('stemBlocks') or [{'type': 'paragraph', 'text': row['stem']}]
            if set_id == 'figures' and not any(block.get('type') == 'paragraph' for block in stem_blocks):
                stem_blocks = [{'type': 'paragraph', 'text': row['stem']}, *stem_blocks]
            question = {
                'id': qid, 'subjectId': subject_id, 'type': 'single', 'practiceSetId': set_id,
                'topicId': skill_id, 'difficulty': row['difficulty'], 'stem': row['stem'],
                'stemBlocks': stem_blocks,
                'options': options, 'answer': row['answer'], 'source': source,
                'sourceAnswer': {'answer': row['answer'], 'explanationBlocks': row['explanationBlocks'],
                    'provider': provenance.get('provider', '平台原创专项练习'), 'url': source['url']},
            }
            if set_id == 'calculation':
                answer_format = row.get('answerFormat', {})
                if answer_format.get('kind') not in ('number', 'percent') or answer_format.get('decimalPlaces') not in (0, 1, 2):
                    raise ValueError('Calculation precision must be explicit: ' + qid)
                if 'roundingUnit' in answer_format and (answer_format['roundingUnit'] not in (10, 100) or answer_format['decimalPlaces'] != 0):
                    raise ValueError('Invalid rounding unit: ' + qid)
                answer = next(option['label'] for option in options if option['value'] == row['answer'])
                if not re.fullmatch(r'-?\d+(?:\.\d+)?%?', answer):
                    raise ValueError('Calculation answer must be numeric: ' + qid)
                question.update(type='fill', answer=answer, answerFormat=answer_format)
                question.pop('options')
                question['sourceAnswer']['answer'] = answer
            question['revision'] = hashlib.sha256(encoded(question).encode()).hexdigest()[:16]
            questions.append(question)
        relative = 'data/question-bank/practice/' + set_id + '.json'
        pending[root / relative] = {'id': set_id, 'title': title, 'questions': questions}
        metadata.append({'id': set_id, 'title': title, 'subjectId': subject_id,
            'path': relative, 'questionCount': len(questions), 'questionIds': [q['id'] for q in questions],
            'modules': list(modules.values()), 'examRoute': exam_route})
        summary[set_id] = {'questions': len(questions), 'modules': len(modules), 'images': len(image_paths),
            'difficulty': dict(Counter(q['difficulty'] for q in questions))}
    manifest['practiceSets'] = metadata
    pending[manifest_path] = manifest
    # Every collection is checked before any published file changes.
    for path, value in pending.items():
        content = encoded(value)
        if not path.exists() or path.read_text(encoding='utf8') != content:
            if check:
                raise ValueError('Focused practice needs rebuilding: ' + str(path.relative_to(root)))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding='utf8')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    print(json.dumps(build(check=args.check), ensure_ascii=False))
