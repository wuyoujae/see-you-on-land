"""Check the exact Pages upload directory without regenerating source data.

The official Pages site limit is 1 GB, even though the artifact service accepts
larger uploads. This check is dependency-free and performs no network requests.
"""

import argparse
import json
import os
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

if __package__:
    from .assemble_static_site import iter_public_files
else:
    from assemble_static_site import iter_public_files


ROOT = Path(__file__).resolve().parents[1]
MAX_SITE_BYTES = 1_000_000_000


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if value and name in {"src", "href", "poster"}:
                self.urls.append(value)


def validate(root=ROOT, directory=None, max_bytes=MAX_SITE_BYTES):
    root = Path(root).resolve()
    directory = Path(directory or root / "_site").absolute()
    if not directory.is_dir() or directory.is_symlink() or getattr(directory, "is_junction", lambda: False)():
        raise ValueError("Pages artifact directory is missing or redirected")
    paths = list(directory.rglob("*"))
    if any(path.is_symlink() or getattr(path, "is_junction", lambda: False)() for path in paths):
        raise ValueError("Pages artifact must not contain symbolic links or junctions")
    files = [path for path in paths if path.is_file()]
    actual = {path.relative_to(directory).as_posix() for path in files}
    expected = {path.relative_to(root).as_posix() for path in iter_public_files(root)} | {".nojekyll"}
    if actual != expected:
        extra, missing = sorted(actual - expected), sorted(expected - actual)
        raise ValueError(f"Pages artifact differs from the public allowlist; unexpected={extra[:8]}, missing={missing[:8]}")
    if "index.html" not in actual:
        raise ValueError("Pages artifact has no index.html")
    if any(path.stat().st_nlink > 1 for path in files):
        raise ValueError("Pages artifact must not contain hard links")
    total = sum(path.stat().st_size for path in files)
    if total >= max_bytes:
        raise ValueError(f"Pages artifact is {total:,} bytes; it must be below {max_bytes:,} bytes")

    references = 0

    def check_reference(value, parent):
        nonlocal references
        url = urlsplit(value.strip())
        if url.scheme or url.netloc or not url.path:
            return
        path = unquote(url.path)
        if "\\" in path or "\x00" in path:
            raise ValueError(f"Invalid local resource in {parent}: {value}")
        # The app is served below /see-you-on-land/ on project Pages. Runtime
        # assets must remain relative to that root, rather than the host root.
        if path.startswith("/"):
            raise ValueError(f"Host-root path breaks project Pages in {parent}: {value}")
        resolved = (directory / parent).parent.joinpath(path).resolve()
        if not resolved.is_relative_to(directory.resolve()):
            raise ValueError(f"Local resource escapes artifact in {parent}: {value}")
        target = resolved.relative_to(directory.resolve()).as_posix()
        if resolved.is_dir():
            target = (resolved / "index.html").relative_to(directory.resolve()).as_posix()
        if target not in actual:
            raise ValueError(f"Missing local resource in {parent}: {value}")
        references += 1

    def json_references(value, trail=()):
        # The legacy knowledge catalog records offline import provenance. The
        # browser reads its page JSON/images, never the source PDF or SQLite.
        if (trail == ("database",) or
            (trail[-2:] == ("source", "path") and isinstance(value, str) and value.lower().endswith(".pdf")) or
            (trail[-1:] == ("ocrDataUrl",) and isinstance(value, str) and value.startswith("data/knowledge/ocr/"))):
            return
        if isinstance(value, str) and value.startswith(("assets/", "data/")):
            check_reference(value, "index.html")
        elif isinstance(value, list):
            for child in value:
                json_references(child, trail)
        elif isinstance(value, dict):
            for key, child in value.items():
                json_references(child, (*trail, key))

    for path in files:
        name = path.relative_to(directory).as_posix()
        if path.suffix.lower() == ".json":
            shipped = json.loads(path.read_text(encoding="utf-8-sig"))
            source = json.loads((root / name).read_text(encoding="utf-8-sig"))
            if shipped != source:
                raise ValueError(f"JSON values changed while assembling: {name}")
            json_references(shipped)
        elif path.suffix.lower() == ".html":
            parser = References()
            parser.feed(path.read_text(encoding="utf-8"))
            for value in parser.urls:
                check_reference(value, name)
        elif path.suffix.lower() == ".css":
            for value in re.findall(r"url\(\s*(['\"]?)(.*?)\1\s*\)", path.read_text(encoding="utf-8"), re.IGNORECASE):
                check_reference(value[1], name)
    return {"files": len(files), "bytes": total, "megabytes": round(total / 1_000_000, 2),
            "limitBytes": max_bytes, "localReferences": references}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=ROOT / "_site")
    args = parser.parse_args(argv)
    result = validate(directory=args.path)
    print(json.dumps(result, ensure_ascii=False))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as output:
            output.write(f"Pages artifact: **{result['files']:,} files, {result['megabytes']:.2f} MB / 1,000 MB**, "
                         f"{result['localReferences']:,} local resource references checked.\n")
    return result


if __name__ == "__main__":
    main()
