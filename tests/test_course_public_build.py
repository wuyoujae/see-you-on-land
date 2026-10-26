"""Public course packaging boundary and local math-resource regression tests."""

import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("assemble_public_test", PROJECT / "scripts" / "assemble_static_site.py")
ASSEMBLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSEMBLE)


class CoursePublicBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="course-public-build-")
        self.root = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)

    def put(self, name, content="fixture"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def public_paths(self):
        return {path.relative_to(self.root).as_posix() for path in ASSEMBLE.iter_public_files(self.root)}

    def test_only_runtime_course_json_and_source_images_are_public(self):
        allowed = {
            "index.html", "data/courses/manifest.json", "data/courses/lessons/example.json",
            "assets/images/courses/original-question.webp", "assets/js/rich-content.js",
            "assets/css/rich-content.css", "assets/vendor/katex/katex.min.js",
            "assets/vendor/katex/katex.min.css", "assets/vendor/katex/fonts/KaTeX_Main-Regular.woff2",
            "assets/vendor/katex/LICENSE",
            "assets/prompts/language.md", "assets/prompts/quantity-wy27-methods.json", "assets/images/question-bank/original.gif",
            "data/question-bank/manifest.json", "data/question-bank/subjects/reasoning.json",
            "data/question-bank/papers/paper-2025.json",
        }
        excluded = {
            "data/courses/coverage-audit.json", "data/courses/parse-error.json", "data/courses/README.md",
            "data/courses/notes.txt", "data/courses/lessons/.hidden.json",
            "data/courses/lessons/nested/private.json", "data/courses/lessons/original.mp4",
            "tmp/transcript.json", "tmp/notes_part1.txt", "outputs/course.docx",
            "assets/images/courses/original.mp4", "assets/images/courses/notes.txt",
            "assets/xiaohei/source.pdf", "data/knowledge/knowledge.sqlite",
            ".openai/hosting.json", "tests/fixture.json",
            "data/question-bank/import-report.json", "data/question-bank/sources/research.json",
            "data/question-bank/papers/raw/private.json", "assets/prompts/.private.md",
            "assets/prompts/quantity-private.json", "assets/prompts/source.pdf",
            "assets/prompts/private/quantity-wy27-methods.json",
        }
        for name in allowed | excluded:
            self.put(name)
        self.assertEqual(self.public_paths(), allowed)

    def test_source_links_and_redirected_parent_directories_are_not_followed(self):
        self.put("index.html")
        target = self.put("tmp/private-lesson.json", "private notes")
        link = self.root / "data/courses/lessons/linked.json"
        link.parent.mkdir(parents=True)
        try:
            link.symlink_to(target)
            source = self.root / "tmp/images"
            source.mkdir()
            (source / "private.png").write_bytes(b"private")
            redirected = self.root / "assets/images/courses"
            redirected.parent.mkdir(parents=True)
            redirected.symlink_to(source, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f"Host does not permit symbolic links: {error}")
        self.assertEqual(self.public_paths(), {"index.html"})

    def test_rebuild_removes_stale_private_files_from_only_the_fixed_output(self):
        self.put("index.html", "public entrypoint")
        self.put("data/courses/manifest.json", "{}")
        self.put("data/courses/lessons/example.json", "{}")
        stale = self.put("_site/tmp/private-notes.txt", "stale")
        with patch.object(ASSEMBLE, "ROOT", self.root):
            ASSEMBLE.main([])
        self.assertFalse(stale.exists())
        self.assertEqual((self.root / "_site/data/courses/lessons/example.json").read_text(), "{}")
        self.assertTrue((self.root / "_site/.nojekyll").is_file())

    def test_sites_client_build_preserves_server_and_rejects_arbitrary_outputs(self):
        self.put("index.html", "public entrypoint")
        self.put("data/courses/manifest.json", "{}")
        self.put("dist/client/tmp/stale.txt", "private")
        server = self.put("dist/server/index.js", "keep worker")
        with patch.object(ASSEMBLE, "ROOT", self.root):
            result = ASSEMBLE.main(["--output", "dist/client"])
            self.assertEqual(result, self.root / "dist/client")
            self.assertFalse((result / "tmp/stale.txt").exists())
            self.assertEqual((result / "index.html").read_text(), "public entrypoint")
            self.assertEqual(server.read_text(), "keep worker")
            with self.assertRaises(ValueError):
                ASSEMBLE.assemble("../outside")
        self.assertEqual(server.read_text(), "keep worker")

    def test_json_compaction_preserves_unicode_formulas_values_and_original_source(self):
        self.put('index.html','entrypoint')
        value={'知识点':'我们先认量','公式':r'\\frac{a+b}{2}',
               'values':[0,False,None,1.25], 'text':'原文\n下一段'}
        formatted=json.dumps(value,ensure_ascii=False,indent=2)
        source=self.put('data/courses/manifest.json',formatted)
        with patch.object(ASSEMBLE,'ROOT',self.root):
            result=ASSEMBLE.assemble('dist/client')
        published=(result/'data/courses/manifest.json').read_text(encoding='utf-8')
        self.assertEqual(json.loads(published),value)
        self.assertLess(len(published.encode('utf-8')),len(formatted.encode('utf-8')))
        self.assertEqual(source.read_text(encoding='utf-8'),formatted)

    def test_output_directory_symlinks_are_rejected_before_deletion(self):
        target = self.root / "retained"
        target.mkdir()
        protected = self.put("retained/private.txt", "keep")
        (self.root / "dist").mkdir()
        try:
            (self.root / "dist/client").symlink_to(target, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f"Host does not permit symbolic links: {error}")
        with patch.object(ASSEMBLE, "ROOT", self.root):
            with self.assertRaises(ValueError):
                ASSEMBLE.assemble("dist/client")
        self.assertEqual(protected.read_text(), "keep")

    def test_real_katex_and_all_its_local_font_references_are_allowlisted(self):
        public = {path.relative_to(PROJECT).as_posix() for path in ASSEMBLE.iter_public_files(PROJECT)}
        vendor = "assets/vendor/katex/"
        for name in ["katex.min.js", "katex.min.css", "LICENSE"]:
            self.assertIn(vendor + name, public)
        css = (PROJECT / vendor / "katex.min.css").read_text(encoding="utf-8")
        fonts = re.findall(r"url\(([^)]+)\)", css)
        self.assertTrue(fonts)
        for font in fonts:
            font = font.strip("\"'")
            self.assertRegex(font, r"^fonts/[^/]+\.woff2$")
            self.assertIn(vendor + font, public)
            self.assertTrue((PROJECT / vendor / font).is_file())


if __name__ == "__main__":
    unittest.main()
