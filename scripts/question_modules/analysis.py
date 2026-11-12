"""Reviewed curriculum classification. No keyword fallback for unreviewed questions."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

_REVIEW_PATH = Path(__file__).with_name("analysis_reviewed.json")
_REVIEWED = None
CONTENT_FIELDS = (
    "stem", "stemBlocks", "options", "materialId", "materialBlocks",
    "answer", "sourceAnswer",
)
COURSE_IDS = (
    "analysis-abrx", "analysis-share", "analysis-mixture",
    "analysis-comparison", "analysis-average", "analysis-annual",
)


def fingerprint(question):
    """Bind the review to the full question, material and reference explanation."""
    payload = {key: question.get(key) for key in CONTENT_FIELDS}
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def module_definitions(courses_subject):
    groups = courses_subject["groups"]
    if {g["id"] for g in groups} != set(COURSE_IDS):
        raise ValueError("Analysis curriculum changed; review module boundaries first")
    return [
        {"id": g["id"], "title": g["title"], "courseGroupId": g["id"]}
        for g in groups
    ] + [
        {"id": "analysis-comprehensive", "title": "综合判断", "supplemental": True},
        {"id": "analysis-basic", "title": "直接查找与基础计算", "supplemental": True},
    ]


def classify(question):
    global _REVIEWED
    if _REVIEWED is None:
        _REVIEWED = json.loads(_REVIEW_PATH.read_text(encoding="utf-8"))["questions"]
    question_id = question.get("id")
    record = _REVIEWED.get(question_id)
    if record is None:
        raise ValueError(f"Unreviewed analysis question: {question_id}")
    if fingerprint(question) != record["fingerprint"]:
        raise ValueError(f"Analysis question changed since review: {question_id}")
    return {key: value for key, value in record.items() if key != "fingerprint"}
