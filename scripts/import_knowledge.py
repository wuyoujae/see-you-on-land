#!/usr/bin/env python3
"""Import all Xiaohei mind-map PDFs into an offline, positional knowledge bank.

The source PDFs remain unchanged. Every PDF text span is retained with its
original coordinates and colour. Adjacent, coloured spans form fill-in answers;
the rendered page preserves the source map instead of guessing its hierarchy.
Run from any directory: python scripts/import_knowledge.py
"""

from __future__ import annotations

import argparse
import base64
import bisect
import colorsys
import concurrent.futures
import hashlib
import io
import json
import re
import sqlite3
import time
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import fitz
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
VERSION = 1
BOOKS = (
    ("地理常识", "geography", "地理常识", "common"),
    ("政治理论思维导图1", "politics-1", "政治理论·上", "politics"),
    ("政治理论思维导图2", "politics-2", "政治理论·下", "politics"),
    ("文史常识", "history", "文史常识", "common"),
    ("法律常识", "law", "法律常识", "common"),
    ("科技常识", "science", "科技常识", "common"),
    ("经济常识", "economics", "经济常识", "common"),
    ("马原理论", "marxism", "马克思主义原理", "politics"),
)
TEXT_FLAGS = fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES


def rect_xywh(rect):
    x0, y0, x1, y1 = rect
    return [round(x0, 3), round(y0, 3), round(x1 - x0, 3), round(y1 - y0, 3)]


def union_bbox(items):
    boxes = [item["bbox"] for item in items]
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    right = max(box[0] + box[2] for box in boxes)
    bottom = max(box[1] + box[3] for box in boxes)
    return [round(left, 3), round(top, 3), round(right - left, 3), round(bottom - top, 3)]


def highlighted(colour):
    # PyMuPDF 1.26+ can expose signed ARGB values. Only RGB belongs in CSS.
    rgb = colour & 0xFFFFFF
    values = ((rgb >> 16 & 255) / 255, (rgb >> 8 & 255) / 255, (rgb & 255) / 255)
    _hue, saturation, value = colorsys.rgb_to_hsv(*values)
    return saturation >= 0.24 and value >= 0.30


def meaningful(text):
    return bool(re.search(r"[\w\u3400-\u9fff]", text, re.UNICODE))


def extract_nodes(page, page_id):
    nodes, blocks = [], []
    for block_index, block in enumerate(page.get_text("dict", flags=TEXT_FLAGS)["blocks"]):
        block_nodes = []
        for line_index, line in enumerate(block.get("lines", [])):
            # Rotated text in the outside margin is a publisher mark, not a fact.
            rotated = abs(line.get("dir", [1, 0])[1]) > 0.2
            for span in line.get("spans", []):
                if not span["text"].strip():
                    continue
                bbox = rect_xywh(span["bbox"])
                content = span["text"].strip()
                footer = bbox[1] > page.rect.height * 0.94 and content.isdigit()
                margin = rotated and (bbox[0] < 25 or bbox[0] > page.rect.width * 0.95)
                node_id = f"{page_id}-n{len(nodes) + 1:04d}"
                node = {
                    "id": node_id,
                    "text": content,
                    "bbox": bbox,
                    "color": f"#{span['color'] & 0xFFFFFF:06x}",
                    "fontSize": round(span["size"], 3),
                    "block": block_index,
                    "line": line_index,
                    "emphasis": highlighted(span["color"]) and not footer and not margin,
                    "role": "page-number" if footer else "publisher-mark" if margin else "content",
                }
                nodes.append(node)
                block_nodes.append(node)
        if block_nodes:
            blocks.append({
                "id": f"{page_id}-b{block_index + 1:04d}",
                "text": "".join(node["text"] for node in block_nodes),
                "bbox": union_bbox(block_nodes),
                "nodeIds": [node["id"] for node in block_nodes],
            })
    return nodes, blocks


def visual_rows(nodes):
    """Join mixed Latin/CJK spans that MuPDF splits despite a shared baseline."""
    rows = []
    for node in sorted((n for n in nodes if n["role"] == "content"), key=lambda n: (n["bbox"][1], n["bbox"][0])):
        x, y, width, height = node["bbox"]
        best, best_overlap = None, 0
        for row in rows:
            ry, rh = row["top"], row["bottom"] - row["top"]
            overlap = max(0, min(y + height, ry + rh) - max(y, ry)) / min(height, rh)
            # Never merge two visually distinct lines with unusually tall glyphs.
            center_difference = abs(y + height / 2 - (ry + rh / 2))
            if overlap >= 0.47 and center_difference <= max(height, rh) * 0.55 and overlap > best_overlap:
                best, best_overlap = row, overlap
        if best is None:
            rows.append({"top": y, "bottom": y + height, "nodes": [node]})
        else:
            best["nodes"].append(node)
            # An average baseline prevents a long chain bridging separate rows.
            best["top"] = sum(n["bbox"][1] for n in best["nodes"]) / len(best["nodes"])
            best["bottom"] = sum(n["bbox"][1] + n["bbox"][3] for n in best["nodes"]) / len(best["nodes"])
    for row in rows:
        row["nodes"].sort(key=lambda node: node["bbox"][0])
    return sorted(rows, key=lambda row: row["top"])


def make_questions(nodes, page_id, page_title):
    questions = []
    for row in visual_rows(nodes):
        groups, active = [], []
        for node in row["nodes"]:
            if not node["emphasis"]:
                if active:
                    groups.append(active)
                    active = []
                continue
            if active:
                previous = active[-1]
                gap = node["bbox"][0] - previous["bbox"][0] - previous["bbox"][2]
                if gap > max(1.25, min(node["fontSize"], previous["fontSize"]) * 0.28):
                    groups.append(active)
                    active = []
            active.append(node)
        if active:
            groups.append(active)
        for group in groups:
            answer = "".join(node["text"] for node in group).strip()
            if not meaningful(answer):
                continue
            number = len(questions) + 1
            # A cue contains source context but never reveals any other blank.
            cue, blank_added = [], False
            for node in row["nodes"]:
                if node["emphasis"]:
                    if not blank_added:
                        cue.append("____")
                        blank_added = True
                else:
                    cue.append(node["text"])
                    blank_added = False
            questions.append({
                "id": f"{page_id}-q{number:03d}",
                "number": number,
                "type": "fill-in",
                "answer": answer,
                "bbox": union_bbox(group),
                "fontSize": round(max(node["fontSize"] for node in group), 3),
                "color": group[0]["color"],
                "segments": [{"text": node["text"], "bbox": node["bbox"], "color": node["color"]} for node in group],
                "nodeIds": [node["id"] for node in group],
                "aliases": [],
                "context": "".join(cue).strip() or page_title,
            })
    return questions


def page_title(blocks, fallback):
    # The PDFs' first text block is the left-side branch/chapter label.
    for block in blocks:
        text = block["text"].strip()
        if text and not text.isdigit() and block["bbox"][0] < 350:
            return text
    return fallback


def render_page(page, path, scale, quality):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    image.save(path, "WEBP", quality=quality, method=4)
    return [pixmap.width, pixmap.height]


@lru_cache(maxsize=16)
def compact_publisher_watermark(mime, payload):
    image = Image.open(io.BytesIO(base64.b64decode(payload)))
    # This exact image is the publisher's very large, faint background mark.
    # Embedded knowledge tables and diagrams are deliberately left untouched.
    if image.size != (4535, 4117):
        return f"data:image/{mime};base64," + payload
    image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, "WEBP", lossless=image.mode == "L", quality=90, method=4)
    return "data:image/webp;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def render_svg(page, path):
    svg = page.get_svg_image(text_as_path=True)
    svg = re.sub(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/=\n\r ]+)", lambda match: compact_publisher_watermark(match.group(1), match.group(2)), svg)
    # PDF coordinates do not need 8+ decimal places; 0.001 pt precision is
    # well below a screen pixel even at the viewer's maximum magnification.
    def simplify_geometry(attribute):
        value = re.sub(r"[-+]?\d*\.\d+(?:[eE][-+]?\d+)?", lambda number: f"{float(number.group(0)):.3f}".rstrip("0").rstrip(".") or "0", attribute.group(2))
        return attribute.group(1) + value + attribute.group(3)
    svg = re.sub(r'(\b(?:d|transform|points)=")([^"]*)(")', simplify_geometry, svg)
    path.write_text(svg, encoding="utf-8")
    return path.stat().st_size


def import_book(job):
    source, target, book_id, title, category, scale, quality = job
    source, target = Path(source), Path(target)
    started = time.monotonic()
    output = target / "pages" / book_id
    output.mkdir(parents=True, exist_ok=True)
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    document = fitz.open(source)
    book = {
        "id": book_id, "title": title, "category": category,
        "source": {"file": source.name, "path": f"assets/xiaohei/{source.name}", "sha256": source_sha},
        "pageCount": len(document), "questionCount": 0, "pages": [],
    }
    stats = {"nodes": 0, "blocks": 0, "characters": 0, "colorCounts": Counter(), "replacementCharacters": 0, "emptyPages": [], "pagesWithoutQuestions": [], "renderedBytes": 0, "pdfWarnings": []}
    for index, page in enumerate(document):
        fitz.TOOLS.mupdf_warnings(reset=True)
        page_id = f"{book_id}-p{index + 1:03d}"
        nodes, blocks = extract_nodes(page, page_id)
        title_for_page = page_title(blocks, f"{title}·第 {index + 1} 页")
        questions = make_questions(nodes, page_id, title_for_page)
        image_fallback = f"data/knowledge/pages/{book_id}/{page_id}.webp"
        image_path = f"data/knowledge/pages/{book_id}/{page_id}.svg"
        data_path = f"data/knowledge/pages/{book_id}/{page_id}.json"
        local_image = output / f"{page_id}.webp"
        pixels = render_page(page, local_image, scale, quality)
        render_svg(page, output / f"{page_id}.svg")
        warnings = fitz.TOOLS.mupdf_warnings(reset=True).strip()
        if warnings:
            stats["pdfWarnings"].append({"page": index + 1, "messages": warnings.splitlines()})
        info = {
            "id": page_id, "bookId": book_id, "number": index + 1,
            "title": title_for_page, "width": round(page.rect.width, 3),
            "height": round(page.rect.height, 3), "image": image_path,
            "imageFallback": image_fallback,
            "dataUrl": data_path, "questionCount": len(questions),
            "kind": "publisher-ad" if index == len(document) - 1 and not nodes else "mindmap" if questions else "reference",
        }
        content = {
            **info, "version": VERSION, "imagePixels": pixels,
            "source": {"file": source.name, "sha256": source_sha, "page": index + 1},
            "nodes": nodes, "blocks": blocks, "questions": questions,
        }
        (output / f"{page_id}.json").write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        book["pages"].append(info)
        book["questionCount"] += len(questions)
        stats["nodes"] += len(nodes)
        stats["blocks"] += len(blocks)
        stats["characters"] += sum(len(node["text"]) for node in nodes)
        stats["colorCounts"].update(node["color"] for node in nodes if node["emphasis"])
        stats["replacementCharacters"] += sum(node["text"].count("\ufffd") for node in nodes)
        stats["renderedBytes"] += local_image.stat().st_size
        if not nodes:
            stats["emptyPages"].append(index + 1)
        if not questions:
            stats["pagesWithoutQuestions"].append(index + 1)
        if index == 0 or (index + 1) % 10 == 0 or index + 1 == len(document):
            print(f"{book_id}: {index + 1}/{len(document)} pages, {book['questionCount']} blanks", flush=True)
    stats["seconds"] = round(time.monotonic() - started, 2)
    return book, stats


def write_manifest(target, books, complete):
    books.sort(key=lambda book: [item[1] for item in BOOKS].index(book["id"]))
    manifest = {
        "version": VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "complete": complete,
        "coordinateSystem": "PDF points; bbox is [x, y, width, height] from the top-left",
        "database": "data/knowledge/knowledge.sqlite",
        "books": books,
        "totalBooks": len(books),
        "totalPages": sum(book["pageCount"] for book in books),
        "totalQuestions": sum(book["questionCount"] for book in books),
    }
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def write_database(target, books):
    path = target / "knowledge.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript("""
        PRAGMA foreign_keys=ON;
        DROP TABLE IF EXISTS question_segments;
        DROP TABLE IF EXISTS questions;
        DROP TABLE IF EXISTS text_nodes;
        DROP TABLE IF EXISTS text_blocks;
        DROP TABLE IF EXISTS raster_images;
        DROP TABLE IF EXISTS pages;
        DROP TABLE IF EXISTS books;
        DROP TABLE IF EXISTS metadata;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE books (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
            source_file TEXT NOT NULL, source_sha256 TEXT NOT NULL,
            page_count INTEGER NOT NULL, question_count INTEGER NOT NULL
        );
        CREATE TABLE pages (
            id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id),
            page_number INTEGER NOT NULL, title TEXT NOT NULL,
            width REAL NOT NULL, height REAL NOT NULL, image_path TEXT NOT NULL,
            data_path TEXT NOT NULL, question_count INTEGER NOT NULL, kind TEXT NOT NULL,
            image_fallback TEXT NOT NULL,
            UNIQUE(book_id, page_number)
        );
        CREATE TABLE text_blocks (
            id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id),
            text TEXT NOT NULL, x REAL, y REAL, width REAL, height REAL,
            node_ids_json TEXT NOT NULL
        );
        CREATE TABLE text_nodes (
            id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id),
            text TEXT NOT NULL, x REAL, y REAL, width REAL, height REAL,
            color TEXT NOT NULL, font_size REAL, block_index INTEGER,
            line_index INTEGER, emphasis INTEGER NOT NULL, role TEXT NOT NULL,
            source_kind TEXT NOT NULL, confidence REAL NOT NULL, source_image_id TEXT
        );
        CREATE TABLE raster_images (
            id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id),
            source_sha256 TEXT NOT NULL, image_xref INTEGER,
            pixel_width INTEGER NOT NULL, pixel_height INTEGER NOT NULL,
            x REAL, y REAL, width REAL, height REAL,
            ocr_engine TEXT NOT NULL, ocr_line_count INTEGER NOT NULL,
            mean_confidence REAL, table_json TEXT
        );
        CREATE TABLE questions (
            id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id),
            question_number INTEGER NOT NULL, type TEXT NOT NULL,
            answer TEXT NOT NULL, aliases_json TEXT NOT NULL,
            context TEXT, x REAL, y REAL, width REAL, height REAL,
            font_size REAL, color TEXT NOT NULL, node_ids_json TEXT NOT NULL,
            UNIQUE(page_id, question_number)
        );
        CREATE TABLE question_segments (
            question_id TEXT NOT NULL REFERENCES questions(id),
            segment_number INTEGER NOT NULL, text TEXT NOT NULL,
            x REAL, y REAL, width REAL, height REAL, color TEXT NOT NULL,
            PRIMARY KEY(question_id, segment_number)
        );
        CREATE INDEX pages_by_book ON pages(book_id, page_number);
        CREATE INDEX questions_by_page ON questions(page_id, question_number);
        CREATE INDEX nodes_by_page ON text_nodes(page_id);
    """)
    connection.executemany("INSERT INTO metadata VALUES (?, ?)", [
        ("schema_version", str(VERSION)),
        ("coordinate_system", "PDF points, top-left origin, bbox [x,y,width,height]"),
        ("extraction", "Native PDF text and RGB colours; embedded black-text images enriched with local RapidOCR; no generated answers"),
    ])
    for book in books:
        connection.execute("INSERT INTO books VALUES (?,?,?,?,?,?,?)", (
            book["id"], book["title"], book["category"], book["source"]["file"],
            book["source"]["sha256"], book["pageCount"], book["questionCount"],
        ))
        for info in book["pages"]:
            page = json.loads((target / "pages" / book["id"] / f"{info['id']}.json").read_text(encoding="utf-8"))
            connection.execute("INSERT INTO pages VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                page["id"], book["id"], page["number"], page["title"], page["width"], page["height"], page["image"], page["dataUrl"], page["questionCount"], page.get("kind", "mindmap"), page.get("imageFallback", page["image"]),
            ))
            connection.executemany("INSERT INTO text_blocks VALUES (?,?,?,?,?,?,?,?)", [
                (block["id"], page["id"], block["text"], *block["bbox"], json.dumps(block["nodeIds"])) for block in page["blocks"]
            ])
            connection.executemany("INSERT INTO text_nodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
                (node["id"], page["id"], node["text"], *node["bbox"], node["color"], node["fontSize"], node["block"], node["line"], int(node["emphasis"]), node["role"], node.get("sourceKind", "pdf"), node.get("confidence", 1.0), node.get("sourceImageId")) for node in page["nodes"]
            ])
            connection.executemany("INSERT INTO raster_images VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
                (raster["id"], page["id"], raster["sha256"], raster.get("xref"), raster["pixelWidth"], raster["pixelHeight"], *raster["bbox"], raster["engine"], raster["lineCount"], raster["meanConfidence"], json.dumps(raster.get("table"), ensure_ascii=False)) for raster in page.get("rasterImages", [])
            ])
            for question in page["questions"]:
                connection.execute("INSERT INTO questions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    question["id"], page["id"], question["number"], question["type"], question["answer"], json.dumps(question["aliases"], ensure_ascii=False), question["context"], *question["bbox"], question["fontSize"], question["color"], json.dumps(question["nodeIds"]),
                ))
                connection.executemany("INSERT INTO question_segments VALUES (?,?,?,?,?,?,?,?)", [
                    (question["id"], index + 1, segment["text"], *segment["bbox"], segment["color"]) for index, segment in enumerate(question["segments"])
                ])
    connection.commit()
    counts = {table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in ("books", "pages", "text_blocks", "text_nodes", "questions", "question_segments", "raster_images")}
    violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise ValueError(f"Database foreign-key violations: {violations}")
    connection.execute("VACUUM")
    connection.close()
    return counts


def prepare_raster_inputs(source, directory):
    """Export actual knowledge images, excluding the known publisher marks."""
    directory.mkdir(parents=True, exist_ok=True)
    tasks = []
    for needle, book_id, _title, _category in BOOKS:
        path = next(path for path in source.glob("*.pdf") if needle in path.stem)
        document = fitz.open(path)
        for index, page in enumerate(document):
            # All eight supplied source files end with the same publisher ad.
            if index == len(document) - 1:
                continue
            image_index = 0
            for entry in page.get_images():
                xref, width, height = entry[0], entry[2], entry[3]
                if width < 500 or height < 100 or (width == 4535 and height == 4117):
                    continue
                for rect in page.get_image_rects(xref):
                    image_index += 1
                    task_id = f"{book_id}-p{index + 1:03d}-r{image_index:02d}"
                    payload = document.extract_image(xref)
                    image_path = directory / f"{task_id}.{payload['ext']}"
                    image_path.write_bytes(payload["image"])
                    tasks.append({
                        "id": task_id, "bookId": book_id,
                        "pageId": f"{book_id}-p{index + 1:03d}", "page": index + 1,
                        "sourceFile": path.name, "xref": xref,
                        "imagePath": str(image_path.resolve()),
                        "pixelWidth": width, "pixelHeight": height,
                        "bbox": rect_xywh(rect),
                    })
    (directory / "manifest.json").write_text(json.dumps(tasks, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return tasks


def run_local_ocr(tasks, directory):
    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
    directory.mkdir(parents=True, exist_ok=True)
    for task in tasks:
        result, elapsed = engine(task["imagePath"], return_word_box=True)
        payload = {**task, "result": result or [], "elapsed": elapsed}
        (directory / f"{task['id']}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=lambda value: value.tolist() if hasattr(value, "tolist") else value.item()) + "\n", encoding="utf-8")
        print(f"OCR {task['id']}: {len(result or [])} lines", flush=True)


def raster_table(task, nodes):
    """Retain physical table rows/cells using visible grid lines, not semantics."""
    import cv2
    import numpy as np

    image = np.array(Image.open(task["imagePath"]).convert("RGB"))
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    ink = (gray < 150).astype(np.uint8) * 255
    height, width = ink.shape
    horizontal = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, max(30, width // 7)), np.uint8))
    vertical = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((max(20, height // 7), 1), np.uint8))

    def boundaries(strength, threshold):
        positions = np.flatnonzero(strength > threshold).tolist()
        groups = []
        for position in positions:
            if not groups or position - groups[-1][-1] > 3:
                groups.append([position])
            else:
                groups[-1].append(position)
        return [sum(group) / len(group) for group in groups]

    rows = boundaries(np.count_nonzero(horizontal, axis=1), width * 0.40)
    columns = boundaries(np.count_nonzero(vertical, axis=0), height * 0.40)
    if len(rows) < 3 or len(columns) < 3:
        return None
    x, y, physical_width, physical_height = task["bbox"]
    row_edges = [y + row / height * physical_height for row in rows]
    column_edges = [x + column / width * physical_width for column in columns]
    cells = {}
    for node in nodes:
        nx, ny, nw, nh = node["bbox"]
        row = bisect.bisect_right(row_edges, ny + nh / 2) - 1
        column = bisect.bisect_right(column_edges, nx + nw / 2) - 1
        if not (0 <= row < len(rows) - 1 and 0 <= column < len(columns) - 1):
            continue
        cell = cells.setdefault((row, column), {
            "row": row, "column": column, "text": "", "nodeIds": [],
            "bbox": [round(column_edges[column], 3), round(row_edges[row], 3), round(column_edges[column + 1] - column_edges[column], 3), round(row_edges[row + 1] - row_edges[row], 3)],
        })
        cell["text"] += ("\n" if cell["text"] else "") + node["text"]
        cell["nodeIds"].append(node["id"])
    return {"rows": len(rows) - 1, "columns": len(columns) - 1, "rowBoundaries": [round(value, 3) for value in row_edges], "columnBoundaries": [round(value, 3) for value in column_edges], "cells": list(cells.values()), "method": "visible-grid-lines; merged cells keep source geometry"}


def enrich_ocr(target, raw_directory):
    tasks_path = raw_directory.parent / "ocr-input" / "manifest.json"
    tasks = json.loads(tasks_path.read_text(encoding="utf-8"))
    corrections_path = target / "ocr-corrections.json"
    if not corrections_path.exists():
        corrections_path = raw_directory / "corrections.json"
    if not corrections_path.exists():
        corrections_path = target / "ocr" / "corrections.json"
    corrections = json.loads(corrections_path.read_text(encoding="utf-8")) if corrections_path.exists() else {}
    cache = target / "ocr"
    cache.mkdir(exist_ok=True)
    pages, low_confidence, node_count = {}, [], 0
    for task_index, task in enumerate(tasks):
        raw_path = raw_directory / f"{task['id']}.json"
        if not raw_path.exists():
            raise FileNotFoundError(f"Incomplete OCR results: {raw_path}")
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        page_path = target / "pages" / task["bookId"] / f"{task['pageId']}.json"
        if task["pageId"] not in pages:
            page = json.loads(page_path.read_text(encoding="utf-8"))
            page["nodes"] = [node for node in page["nodes"] if node.get("sourceKind") != "ocr"]
            page["blocks"] = [block for block in page["blocks"] if block.get("sourceKind") != "ocr"]
            page["rasterImages"] = []
            pages[task["pageId"]] = page
        page = pages[task["pageId"]]
        x, y, width, height = task["bbox"]
        nodes = []
        for index, item in enumerate(raw["result"] or []):
            quad, text, confidence = item[:3]
            original_text = text
            correction = corrections.get(task["id"], {}).get(str(index))
            if correction is not None:
                text = correction
            if not text.strip():
                continue
            xs, ys = [point[0] for point in quad], [point[1] for point in quad]
            bbox = [round(x + min(xs) / task["pixelWidth"] * width, 3), round(y + min(ys) / task["pixelHeight"] * height, 3), round((max(xs) - min(xs)) / task["pixelWidth"] * width, 3), round((max(ys) - min(ys)) / task["pixelHeight"] * height, 3)]
            node = {
                "id": f"{task['id']}-n{index + 1:03d}", "text": text,
                "bbox": bbox, "color": "#141414", "fontSize": round(bbox[3], 3),
                "block": 10000 + task_index, "line": index, "emphasis": False,
                "role": "content", "sourceKind": "ocr", "sourceImageId": task["id"],
                "confidence": round(float(confidence), 6),
            }
            if correction is not None:
                node.update({"rawText": original_text, "visuallyCorrected": True})
            nodes.append(node)
            if confidence < 0.92:
                low_confidence.append({"imageId": task["id"], "line": index, "text": text, "confidence": round(float(confidence), 6), "visuallyCorrected": correction is not None})
        page["nodes"].extend(nodes)
        page["blocks"].append({
            "id": f"{task['id']}-block", "text": "\n".join(node["text"] for node in nodes),
            "bbox": task["bbox"], "nodeIds": [node["id"] for node in nodes], "sourceKind": "ocr",
        })
        raster = {
            "id": task["id"], "bbox": task["bbox"], "xref": task.get("xref"),
            "pixelWidth": task["pixelWidth"], "pixelHeight": task["pixelHeight"],
            "sha256": hashlib.sha256(Path(task["imagePath"]).read_bytes()).hexdigest(),
            "engine": "RapidOCR / PP-OCRv4 / ONNX Runtime (local)",
            "lineCount": len(nodes), "meanConfidence": round(sum(node["confidence"] for node in nodes) / max(len(nodes), 1), 6),
            "table": raster_table(task, nodes),
            "ocrDataUrl": f"data/knowledge/ocr/{task['id']}.json",
        }
        page["rasterImages"].append(raster)
        node_count += len(nodes)
        durable = {key: value for key, value in raw.items() if key not in ("imagePath", "wallSeconds")}
        durable["corrections"] = corrections.get(task["id"], {})
        durable["imageSha256"] = raster["sha256"]
        (cache / f"{task['id']}.json").write_text(json.dumps(durable, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for page_id, page in pages.items():
        (target / "pages" / page["bookId"] / f"{page_id}.json").write_text(json.dumps(page, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if corrections:
        (cache / "corrections.json").write_text(json.dumps(corrections, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (target / "ocr-corrections.json").write_text(json.dumps(corrections, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"complete": True, "images": len(tasks), "pages": len(pages), "nodes": node_count, "lowConfidenceLines": low_confidence, "note": "All 29 embedded knowledge images were visually reviewed: their text is black. OCR enriches knowledge text only; coloured table backgrounds and diagram lines do not become fill-in questions."}


def refresh_report(target, manifest, ocr_summary):
    books = manifest["books"]
    report_path = target / "import-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    all_images_present, all_boxes_within_page = True, True
    svg_count, svg_bytes = 0, 0
    for book in books:
        stats = report["books"][book["id"]]
        stats.update({"nodes": 0, "blocks": 0, "characters": 0, "advertisementPages": [], "referencePages": [], "ocrNodes": 0})
        for info in book["pages"]:
            path = target / "pages" / book["id"] / f"{info['id']}.json"
            page = json.loads(path.read_text(encoding="utf-8"))
            page["kind"] = "publisher-ad" if info["number"] == book["pageCount"] and not page["nodes"] else "mindmap" if page["questionCount"] else "reference"
            info["kind"] = page["kind"]
            if page["image"].endswith(".svg"):
                svg_path = target / "pages" / book["id"] / f"{info['id']}.svg"
                svg_count += int(svg_path.exists())
                svg_bytes += svg_path.stat().st_size if svg_path.exists() else 0
            all_images_present = all_images_present and (ROOT / page["image"]).is_file()
            for question in page["questions"]:
                qx, qy, qw, qh = question["bbox"]
                all_boxes_within_page = all_boxes_within_page and 0 <= qx < qx + qw <= page["width"] + 1 and 0 <= qy < qy + qh <= page["height"] + 1
            path.write_text(json.dumps(page, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            stats["nodes"] += len(page["nodes"])
            stats["blocks"] += len(page["blocks"])
            stats["characters"] += sum(len(node["text"]) for node in page["nodes"])
            stats["ocrNodes"] += sum(node.get("sourceKind") == "ocr" for node in page["nodes"])
            if page["kind"] == "publisher-ad":
                stats["advertisementPages"].append(info["number"])
            elif page["kind"] == "reference":
                stats["referencePages"].append(info["number"])
        book["contentPageCount"] = book["pageCount"] - len(stats["advertisementPages"])
    manifest = write_manifest(target, books, complete=True)
    manifest["contentPageCount"] = sum(book["contentPageCount"] for book in books)
    manifest["ocrComplete"] = ocr_summary["complete"]
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report["ocr"] = ocr_summary
    report["totals"] = write_database(target, books)
    report["contentPageCount"] = manifest["contentPageCount"]
    report["advertisementPageCount"] = manifest["totalPages"] - manifest["contentPageCount"]
    report["dataValidation"] = {
        "allPageImagesPresent": all_images_present,
        "allQuestionBoxesWithinPage": all_boxes_within_page,
        "databaseForeignKeyCheck": "passed",
        "nativeReplacementCharacters": sum(stats["replacementCharacters"] for stats in report["books"].values()),
        "quizAnswersFromNativePdfOnly": True,
        "noOcrDerivedQuizAnswers": True,
    }
    if svg_count:
        report["svg"] = {"pages": svg_count, "bytes": svg_bytes, "textAsPath": True, "publisherWatermarkMaxDimension": 1600, "knowledgeImageResolution": "unchanged", "fallback": "WebP"}
    report["limitations"] = list(dict.fromkeys(report["limitations"] + [
        "Embedded black-text tables and diagrams were enriched by local OCR; OCR confidence and raw results are retained for review, and no OCR-derived quiz answers were generated.",
        "All eight final publisher advertising pages are preserved as page images but explicitly excluded from knowledge questions.",
    ]))
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def upgrade_svg_book(job):
    book, source, target = job
    source, target = Path(source), Path(target)
    document = fitz.open(source / book["source"]["file"])
    total_bytes = 0
    for page, info in zip(document, book["pages"]):
        output = target / "pages" / book["id"] / f"{info['id']}.svg"
        total_bytes += render_svg(page, output)
        path = target / "pages" / book["id"] / f"{info['id']}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        fallback = f"data/knowledge/pages/{book['id']}/{info['id']}.webp"
        for obj in (info, data):
            obj["image"] = f"data/knowledge/pages/{book['id']}/{info['id']}.svg"
            obj["imageFallback"] = fallback
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"SVG {book['id']}: {len(document)} pages / {total_bytes / 1_000_000:.2f} MB", flush=True)
    return book


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "assets" / "xiaohei")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "knowledge")
    parser.add_argument("--scale", type=float, default=1.75)
    parser.add_argument("--quality", type=int, default=90)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--skip-ocr", action="store_true", help="Skip optional embedded-image OCR enrichment")
    parser.add_argument("--enrich-ocr", type=Path, help="Enrich existing pages using a directory of local OCR results without rendering PDFs again")
    parser.add_argument("--upgrade-svg", action="store_true", help="Upgrade existing backgrounds to outlined SVG while retaining WebP fallbacks")
    options = parser.parse_args()
    options.output.mkdir(parents=True, exist_ok=True)
    if options.upgrade_svg:
        manifest = json.loads((options.output / "manifest.json").read_text(encoding="utf-8"))
        with concurrent.futures.ProcessPoolExecutor(max_workers=options.workers) as pool:
            futures = [pool.submit(upgrade_svg_book, (book, str(options.source), str(options.output))) for book in manifest["books"]]
            manifest["books"] = [future.result() for future in concurrent.futures.as_completed(futures)]
        report = json.loads((options.output / "import-report.json").read_text(encoding="utf-8"))
        report = refresh_report(options.output, manifest, report.get("ocr", {"complete": False}))
        print(json.dumps({"complete": True, **report["svg"], "questions": report["totals"]["questions"]}), flush=True)
        return
    if options.enrich_ocr:
        manifest = json.loads((options.output / "manifest.json").read_text(encoding="utf-8"))
        summary = enrich_ocr(options.output, options.enrich_ocr)
        report = refresh_report(options.output, manifest, summary)
        print(json.dumps({"complete": True, **report["totals"], "ocrImages": summary["images"]}), flush=True)
        return
    jobs = []
    for needle, book_id, title, category in BOOKS:
        files = [path for path in sorted(options.source.glob("*.pdf")) if needle in path.stem]
        if len(files) != 1:
            raise ValueError(f"Expected one PDF for {book_id}, found {files}")
        jobs.append((str(files[0]), str(options.output), book_id, title, category, options.scale, options.quality))
    started = time.monotonic()
    books, stats = [], {}
    with concurrent.futures.ProcessPoolExecutor(max_workers=options.workers) as pool:
        futures = [pool.submit(import_book, job) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            book, result = future.result()
            books.append(book)
            stats[book["id"]] = result
            write_manifest(options.output, books, complete=len(books) == len(jobs))
            print(f"Finished {book['id']}: {book['pageCount']} pages / {book['questionCount']} blanks", flush=True)
    manifest = write_manifest(options.output, books, complete=True)
    counts = write_database(options.output, books)
    report = {
        "version": VERSION, "generatedAt": manifest["generatedAt"],
        "complete": True, "totals": counts, "books": stats,
        "render": {"format": "WebP", "scale": options.scale, "quality": options.quality},
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "limitations": [
            "Answer matching uses the exact source phrase; no semantic synonyms were invented.",
            "Adjacent coloured spans on one visual line are merged; separate lines remain separate blanks to preserve precise masking.",
            "Source chapter labels, line art and embedded publisher marks remain in the unmodified page background.",
            "Spatial blocks and spans are retained; semantic parent-child relationships are not guessed.",
            "D/G/Z/M/Q letter abbreviations and other wording in the source are preserved verbatim.",
        ],
    }
    (options.output / "import-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not options.skip_ocr:
        temporary = ROOT / "tmp" / "pdfs"
        tasks = prepare_raster_inputs(options.source, temporary / "ocr-input")
        run_local_ocr(tasks, temporary / "ocr-results")
        summary = enrich_ocr(options.output, temporary / "ocr-results")
        report = refresh_report(options.output, manifest, summary)
        counts = report["totals"]
    print(json.dumps({"complete": True, **counts, "seconds": report["elapsedSeconds"]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
    if __package__:
        from .build_knowledge_points import build_library
    else:
        from build_knowledge_points import build_library
    build_library()
