"""Exercise the real allowlist/asset validation without publishing anything."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import assemble_static_site as assembler
from scripts.validate_pages_artifact import validate


class PagesArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pages-artifact-")
        self.root = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)
        self.put("index.html", '<link href="assets/css/site.css" rel="stylesheet"><script src="assets/js/site.js"></script>')
        self.put("assets/css/site.css", 'body{background:url("../images/background.png")}')
        self.put("assets/images/background.png", "image fixture")
        self.put("assets/js/site.js", "/* no side effects */")
        self.put("data/courses/manifest.json", json.dumps({"image": "assets/images/background.png"}))
        with patch.object(assembler, "ROOT", self.root):
            self.site = assembler.assemble()

    def put(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")
        return path

    def test_valid_compacted_site_and_relative_assets_pass(self):
        result = validate(self.root, self.site)
        self.assertEqual(result["files"], 6)
        self.assertEqual(result["localReferences"], 4)
        self.assertLess(result["bytes"], result["limitBytes"])

    def test_non_public_source_and_stale_files_are_rejected(self):
        for relative in ["source.pdf", "data/courses/sources/private.json", "tmp/transcript.txt", ".credentials"]:
            extra = self.site / relative
            extra.parent.mkdir(parents=True, exist_ok=True)
            extra.write_text("private", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "allowlist"):
                validate(self.root, self.site)
            extra.unlink()

    def test_missing_or_changed_public_values_cannot_be_deployed(self):
        target = self.site / "data/courses/manifest.json"
        before = target.read_text()
        target.write_text('{"image":"changed"}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "JSON values changed"):
            validate(self.root, self.site)
        target.write_text(before, encoding="utf-8")
        (self.site / "assets/js/site.js").unlink()
        with self.assertRaisesRegex(ValueError, "missing="):
            validate(self.root, self.site)

    def test_pages_site_budget_is_checked_before_upload(self):
        with self.assertRaisesRegex(ValueError, "must be below"):
            validate(self.root, self.site, max_bytes=10)

    def test_css_and_json_references_and_project_base_paths_are_checked(self):
        css = self.site / "assets/css/site.css"
        for text, expected in [('body{background:url("../images/missing.png")}', "Missing local resource"),
                               ('body{background:url("/assets/images/background.png")}', "Host-root path"),
                               ('body{background:url("../../../secret.png")}', "escapes artifact")]:
            css.write_text(text, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, expected):
                validate(self.root, self.site)

    def test_external_and_data_resources_do_not_trigger_network_requests(self):
        (self.site / "assets/css/site.css").write_text('body{background:url(data:image/png;base64,AA)}@font-face{src:url(https://example.invalid/font.woff2)}', encoding="utf-8")
        result = validate(self.root, self.site)
        self.assertEqual(result["localReferences"], 3)

    def test_offline_provenance_is_not_a_runtime_dependency_but_source_original_images_are(self):
        payload = {"database": "data/knowledge/knowledge.sqlite", "rasterImages": [{"ocrDataUrl": "data/knowledge/ocr/local.json"}], "source": {"path": "assets/xiaohei/private.pdf",
                   "originalImages": [{"src": "assets/images/background.png"}]}}
        text = json.dumps(payload)
        for directory in [self.root, self.site]:
            (directory / "data/courses/manifest.json").write_text(text, encoding="utf-8")
        self.assertEqual(validate(self.root, self.site)["localReferences"], 4)


if __name__ == "__main__":
    unittest.main()
