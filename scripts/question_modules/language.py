"""Reviewed language-bank classification; never infer a module for new content.

Keep language-reviewed.json beside this file.  The reviewed set is deliberately
closed: a new ID or changed question must be reviewed before it can be imported.
"""
from functools import lru_cache
import hashlib
import json
from pathlib import Path

GROUP_IDS = (
    "language-main-idea-basics", "language-argumentative",
    "language-expository", "language-news", "language-title",
    "language-next-paragraph", "language-sentence-fill",
    "language-sentence-order", "language-detail", "language-logical-fill",
)
CONTENT_KEYS = (
    "id", "subjectId", "type", "stem", "stemBlocks", "materialId",
    "material", "materialBlocks", "options", "answer",
)


def content_sha256(question):
    content = {key: question[key] for key in CONTENT_KEYS if key in question}
    encoded = json.dumps(content, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def module_definitions(courses_subject):
    groups = {group["id"]: group for group in courses_subject["groups"]}
    missing = set(GROUP_IDS) - groups.keys()
    if missing:
        raise ValueError(f"Missing language course modules: {sorted(missing)}")
    return [{"id": group_id, "title": groups[group_id]["title"],
             "courseGroupId": group_id} for group_id in GROUP_IDS]


@lru_cache(maxsize=1)
def _reviewed():
    data = json.loads(Path(__file__).with_name("language-reviewed.json")
                      .read_text(encoding="utf-8"))
    rows = data["questions"]
    result = {row["id"]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Duplicate IDs in reviewed language classifications")
    if any(row["topicId"] not in GROUP_IDS for row in rows):
        raise ValueError("Unknown module in reviewed language classifications")
    return result


def classify(question):
    question_id = question.get("id")
    row = _reviewed().get(question_id)
    if row is None:
        raise ValueError(f"Unreviewed language question: {question_id}")
    if content_sha256(question) != row["contentSha256"]:
        raise ValueError(f"Language question content changed; review required: {question_id}")
    keys = ("topicId", "method", "evidence", "courseLessonId", "courseQuestionId")
    return {key: row[key] for key in keys if key in row}
