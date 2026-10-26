"""Restore reviewed data-analysis source-board images after course regeneration.

Only image blocks are appended to existing cards; IDs, card counts, questions and
source metadata are preserved. Images are checked-in public assets, so this
script does not need the private video frames or source notes.
"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMAGE_ROOT = "assets/images/courses/"
ATTACHMENTS = (
    {
        "lesson": "analysis-p1-l02", "card": "analysis-p1-l02-knowledge-756ddf8-01",
        "role": "knowledge", "frame_seconds": 300, "file": "analysis-abrx-board.jpg",
        "alt": "ABRX基期与现期公式原板书，含间隔基期和等增量后推",
        "caption": "ABRX原板书，点击放大。",
    },
    {
        "lesson": "analysis-p1-l09", "card": "analysis-p1-l09-knowledge-b687740-03",
        "role": "knowledge", "frame_seconds": 1500, "file": "analysis-share-difference-board.jpg",
        "alt": "两期比重趋势与差值公式原板书",
        "caption": "两期比重差原板书，点击放大。",
    },
    {
        "lesson": "analysis-p2-l01", "card": "analysis-p2-l01-knowledge-234d305-02",
        "role": "knowledge", "frame_seconds": 2560, "file": "analysis-cross-weight-board.jpg",
        "alt": "十字交叉原板书，用城乡人均收入和男女网购次数求人数比",
        "caption": "十字交叉原板书，点击放大。",
    },
    {
        "lesson": "analysis-p2-l13", "card": "analysis-q004-explanation-2f1a567-02",
        "role": "explanation", "question": "analysis-q004", "frame_seconds": 4440,
        "file": "analysis-annual-grid-board.jpg",
        "alt": "年均增长率格尺法原板书，含10%与15%锚点及分格定位",
        "caption": "格尺法原板书，点击放大。",
    },
)


def attach(root=ROOT):
    root = Path(root).resolve()
    pending = []
    # Validate the complete plan before touching any lesson. Stable card IDs
    # prevent a later generator change from putting a solution image on a quiz.
    for item in ATTACHMENTS:
        image = IMAGE_ROOT + item["file"]
        if not (root / image).is_file():
            raise FileNotFoundError(f"Missing reviewed course image: {image}")
        lesson = root / "data/courses/lessons" / (item["lesson"] + ".json")
        content = json.loads(lesson.read_text(encoding="utf-8-sig"))
        matches = [card for card in content["cards"] if card["id"] == item["card"]]
        if len(matches) != 1:
            raise ValueError(f"Expected one reviewed card: {item['lesson']}/{item['card']}")
        card = matches[0]
        if card.get("type") != "text" or card.get("role") != item["role"]:
            raise ValueError(f"Image target is not the expected text card: {item['card']}")
        if item.get("question") and card.get("questionId") != item["question"]:
            raise ValueError(f"Solution image must stay gated to its question: {item['card']}")
        if any(block.get("type") == "image" and block.get("src") == image for block in card["blocks"]):
            continue
        card["blocks"].append({"type": "image", "src": image, "alt": item["alt"], "caption": item["caption"]})
        pending.append((lesson, content))
    for lesson, content in pending:
        temporary = lesson.with_suffix(".json.image-tmp")
        temporary.write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(lesson)
    return len(pending)


if __name__ == "__main__":
    print(f"Attached images to {attach()} lesson(s); {len(ATTACHMENTS)} reviewed mappings checked.")
