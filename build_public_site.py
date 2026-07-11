import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist" / "server"


def javascript_string(path):
    return json.dumps(path.read_text(encoding="utf-8"), ensure_ascii=False)


def main():
    routes = {
        "/": ("text/html; charset=utf-8", ROOT / "index.html"),
        "/index.html": ("text/html; charset=utf-8", ROOT / "index.html"),
        "/learning-data.js": ("text/javascript; charset=utf-8", ROOT / "learning-data.js"),
        "/current-affairs-data.js": ("text/javascript; charset=utf-8", ROOT / "current-affairs-data.js"),
    }
    route_source = ",\n".join(
        f"  {json.dumps(route)}: {{ type: {json.dumps(content_type)}, body: {javascript_string(path)} }}"
        for route, (content_type, path) in routes.items()
    )
    worker = f"""const routes = {{\n{route_source}\n}};

export default {{
  async fetch(request) {{
    const url = new URL(request.url);
    const asset = routes[url.pathname];
    if (!asset) return new Response("Not found", {{ status: 404 }});
    return new Response(asset.body, {{
      headers: {{
        "content-type": asset.type,
        "cache-control": url.pathname.endsWith("data.js") ? "public, max-age=300" : "public, max-age=3600",
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
