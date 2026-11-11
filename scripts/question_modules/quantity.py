"""Reviewed primary-module mapping aligned with the Wang Yan 27 curriculum.

Assignments are content bound. Unknown or changed questions must be reviewed;
the importer must not silently put them into a catch-all module.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

_FILE = Path(__file__).with_name('quantity_reviewed.json')
_REVIEWED = None
EXTRAS = [
    {'id': 'quantity-number-sequences', 'title': '数字推理', 'supplemental': True},
    {'id': 'quantity-cycles', 'title': '周期与日期', 'supplemental': True},
    {'id': 'quantity-planning', 'title': '统筹与数学推理', 'supplemental': True},
    {'id': 'quantity-intervals', 'title': '植树与间隔', 'supplemental': True},
    {'id': 'quantity-basic', 'title': '基础计算', 'supplemental': True},
]

def module_definitions(courses_subject):
    return [{'id': g['id'], 'title': g['title'], 'courseGroupId': g['id']}
            for g in courses_subject['groups']] + [dict(x) for x in EXTRAS]

def fingerprint(question):
    fields = {key: question.get(key) for key in ('stem', 'stemBlocks', 'options', 'materialBlocks')}
    return hashlib.sha256(json.dumps(fields, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def classify(question):
    global _REVIEWED
    if _REVIEWED is None:
        _REVIEWED = json.loads(_FILE.read_text(encoding='utf8'))['questions']
    record = _REVIEWED.get(question['id'])
    if not record or record['fingerprint'] != fingerprint(question):
        raise ValueError('Quantity question needs curriculum review: ' + question['id'])
    return {key: value for key, value in record.items() if key != 'fingerprint'}
