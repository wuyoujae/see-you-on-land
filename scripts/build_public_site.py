import base64
import json
from pathlib import Path

if __package__:
    from .assemble_static_site import iter_public_files
else:
    from assemble_static_site import iter_public_files


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist" / "server"
CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".license": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}


def asset_record(path):
    content_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
    is_text = content_type.startswith("text/") or path.suffix.lower() in {".json", ".svg"}
    body = path.read_text(encoding="utf-8") if is_text else base64.b64encode(path.read_bytes()).decode("ascii")
    return {"type": content_type, "body": body, "base64": not is_text}


def main():
    routes = {}
    for path in iter_public_files(ROOT):
        routes["/" + path.relative_to(ROOT).as_posix()] = asset_record(path)
    routes["/"] = routes["/index.html"]
    route_source = json.dumps(routes, ensure_ascii=False)
    worker = f"""const routes = {route_source};

export default {{
  async fetch(request) {{
    const url = new URL(request.url);
    const asset = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null;
    if (!asset) return new Response("Not found", {{ status: 404 }});
    const body = asset.base64
      ? Uint8Array.from(atob(asset.body), character => character.charCodeAt(0))
      : asset.body;
    return new Response(body, {{
      headers: {{
        "content-type": asset.type,
        "cache-control": url.pathname.startsWith("/data/") ? "public, max-age=300" : "public, max-age=3600",
        "x-content-type-options": "nosniff"
      }}
    }});
  }}
}};
"""
    DIST.mkdir(parents=True, exist_ok=True)
    (DIST / "index.js").write_text(worker, encoding="utf-8")
    print(f"Built {DIST / 'index.js'}")


if __name__ == "__main__":
    main()
