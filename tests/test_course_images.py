"""Image attachment is repeatable and cannot alter question ordering/metadata."""

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("attach_images_test", Path(__file__).resolve().parents[1] / "scripts/attach_course_images.py")
ATTACHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ATTACHER)


class CourseImageAttachmentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="course-image-test-")
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.original = {}
        for item in ATTACHER.ATTACHMENTS:
            image = self.root / ATTACHER.IMAGE_ROOT / item["file"]
            image.parent.mkdir(parents=True, exist_ok=True)
            image.write_bytes(b"fixture image")
            card = {"id": item["card"], "type": "text", "role": item["role"], "blocks": [{"type": "paragraph", "text": "Original explanation"}]}
            if item.get("question"):
                card["questionId"] = item["question"]
            content = {"id": item["lesson"], "source": {"videoId": "retained", "startSeconds": 3}, "cards": [card]}
            self.original[item["lesson"]] = copy.deepcopy(content)
            lesson = self.lesson_path(item)
            lesson.parent.mkdir(parents=True, exist_ok=True)
            lesson.write_text(json.dumps(content), encoding="utf-8")

    def lesson_path(self, item):
        return self.root / "data/courses/lessons" / (item["lesson"] + ".json")

    def test_append_then_repeat_without_any_other_changes(self):
        self.assertEqual(ATTACHER.attach(self.root), len(ATTACHER.ATTACHMENTS))
        after = {}
        for item in ATTACHER.ATTACHMENTS:
            lesson = self.lesson_path(item)
            after[lesson] = lesson.read_bytes()
            content = json.loads(after[lesson])
            block = content["cards"][0]["blocks"].pop()
            self.assertEqual(block["src"], ATTACHER.IMAGE_ROOT + item["file"])
            self.assertTrue(block["alt"])
            self.assertEqual(content, self.original[item["lesson"]])
        self.assertEqual(ATTACHER.attach(self.root), 0)
        for lesson, content in after.items():
            self.assertEqual(lesson.read_bytes(), content)

    def test_missing_asset_fails_before_changing_any_lesson(self):
        item = ATTACHER.ATTACHMENTS[-1]
        (self.root / ATTACHER.IMAGE_ROOT / item["file"]).unlink()
        before = {self.lesson_path(item): self.lesson_path(item).read_bytes() for item in ATTACHER.ATTACHMENTS}
        with self.assertRaises(FileNotFoundError):
            ATTACHER.attach(self.root)
        for lesson, content in before.items():
            self.assertEqual(lesson.read_bytes(), content)

    def test_changed_target_role_cannot_put_an_answer_on_a_question(self):
        item = ATTACHER.ATTACHMENTS[0]
        lesson = self.lesson_path(item)
        content = json.loads(lesson.read_text())
        content["cards"][0]["type"] = "question"
        lesson.write_text(json.dumps(content), encoding="utf-8")
        with self.assertRaises(ValueError):
            ATTACHER.attach(self.root)


if __name__ == "__main__":
    unittest.main()
