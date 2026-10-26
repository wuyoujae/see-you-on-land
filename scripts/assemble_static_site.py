"""Assemble browser resources while keeping source PDFs and import artifacts local."""

from pathlib import Path
import argparse
import json
import shutil


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIRECTORIES = ("_site", "dist/client")
IMAGE_SUFFIXES = {".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico"}
FONT_SUFFIXES = {".woff", ".woff2", ".ttf"}
LICENSE_SUFFIXES = {".txt", ".license"}
VENDOR_LICENSE_FILENAMES = {"license"}
ASSET_DIRECTORIES = {
    "css": {".css"},
    "js": {".js"},
    "fonts": FONT_SUFFIXES | LICENSE_SUFFIXES,
    "vendor": {".css", ".js"} | IMAGE_SUFFIXES | FONT_SUFFIXES | LICENSE_SUFFIXES,
    "images": IMAGE_SUFFIXES,
    "icons": IMAGE_SUFFIXES,
    "prompts": {".md"},
}
DATA_FILES = (
    "learning-data.js",
    "current-affairs-data.js",
    "current-affairs-data.json",
    "wrong-question-taxonomy.json",
    "exams.json",
)


def is_regular_public_file(path, root):
    """Reject links/junctions, including a redirected parent directory.

    A suffix allowlist must not accidentally publish a local authoring directory
    through an assets/ or data/ junction, even when its target is inside ROOT.
    """
    path, root = Path(path), Path(root)
    if not path.is_file() or not path.is_relative_to(root):
        return False
    relative = path.relative_to(root)
    if any(part.startswith(".") for part in relative.parts):
        return False
    current = root
    for part in relative.parts:
        current /= part
        if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
            return False
    return path.resolve().is_relative_to(root)


def iter_public_files(root=ROOT):
    """Yield the same explicit browser asset set for both deployment formats.

    In particular, never recurse over all of assets/ or data/. The original
    assets/xiaohei PDFs, local SQLite database, and conversion reports are
    authoring inputs rather than resources the browser needs.
    """
    root = Path(root).resolve()
    entrypoint = root / "index.html"
    if is_regular_public_file(entrypoint, root):
        yield entrypoint

    for name, suffixes in ASSET_DIRECTORIES.items():
        directory = root / "assets" / name
        for path in sorted(directory.rglob("*")):
            if (
                is_regular_public_file(path, root)
                and (
                    path.suffix.lower() in suffixes
                    or name == "vendor" and path.name.lower() in VENDOR_LICENSE_FILENAMES
                    or name == "prompts" and path.relative_to(directory).as_posix() == "quantity-wy27-methods.json"
                )
            ):
                yield path

    for name in DATA_FILES:
        path = root / "data" / name
        if is_regular_public_file(path, root):
            yield path

    knowledge = root / "data" / "knowledge"
    manifest = knowledge / "manifest.json"
    if is_regular_public_file(manifest, root):
        yield manifest
    for name in ("points.json", "daily-points.json"):
        index = knowledge / name
        if is_regular_public_file(index, root):
            yield index

    pages = knowledge / "pages"
    for path in sorted(pages.rglob("*")):
        if (
            is_regular_public_file(path, root)
            and path.suffix.lower() in {".json", ".webp", ".svg"}
        ):
            yield path

    # Courses publish only the runtime manifest and direct lesson JSON files.
    # Reports, corrections, source notes and video files stay local. In
    # particular, do not broaden this to data/courses/**/*.json.
    courses = root / "data" / "courses"
    course_manifest = courses / "manifest.json"
    if is_regular_public_file(course_manifest, root):
        yield course_manifest
    for path in sorted((courses / "lessons").glob("*.json")):
        if is_regular_public_file(path, root):
            yield path

    # Exam banks publish the manifest plus flat subject/paper runtime documents,
    # never raw imports, research/source reports or authoring directories.
    bank = root / "data" / "question-bank"
    bank_manifest = bank / "manifest.json"
    if is_regular_public_file(bank_manifest, root):
        yield bank_manifest
    for name in ("subjects", "papers"):
        for path in sorted((bank / name).glob("*.json")):
            if is_regular_public_file(path, root):
                yield path


def output_directory(output, root):
    """Resolve one of two fixed outputs before any recursive removal."""
    if output not in OUTPUT_DIRECTORIES:
        raise ValueError("Unknown public output directory")
    root = Path(root).resolve()
    expected = root / output
    current = root
    for part in Path(output).parts:
        current /= part
        if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
            raise ValueError(f"Refusing to replace a redirected {output} directory")
    if expected.resolve() != expected or not expected.is_relative_to(root):
        raise ValueError("Public output must stay within the workspace")
    return expected


def assemble(output="_site"):
    root = ROOT.resolve()
    site = output_directory(output, root)
    # Only the checked, fixed output is recreated. dist/server is not touched
    # when assembling dist/client, and old private files cannot survive a build.
    if site.exists():
        shutil.rmtree(site)
    site.mkdir(parents=True)

    count = 0
    for source in iter_public_files(root):
        destination = site / source.relative_to(root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix.lower()=='.json':
            # Keep reviewed sources readable in Git; publish the identical JSON
            # values without indentation so large exercise banks fit hosting.
            value=json.loads(source.read_text(encoding='utf-8-sig'))
            destination.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
        else:
            shutil.copy2(source, destination)
        count += 1
    (site / ".nojekyll").touch()
    print(f"Assembled {count} public files in {site}")
    return site


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", choices=OUTPUT_DIRECTORIES, default="_site",
                        help="Fixed public output: _site for Pages, dist/client for Sites")
    args = parser.parse_args(argv)
    return assemble(args.output)


if __name__ == "__main__":
    main()
