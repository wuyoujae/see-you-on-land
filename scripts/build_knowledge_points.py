#!/usr/bin/env python3
"""Build question indexes and readable daily facts from the local source maps.

Only native PDF text is used. Answers, identifiers and source references are
retained verbatim; this script does not synthesize facts or use external data.
Run: python scripts/build_knowledge_points.py
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "knowledge"
GENERIC = {"含义", "概念", "定义", "内容", "分类", "特点", "特征", "地位", "意义", "作用", "代表", "包括", "衡量", "基本原则", "知识延伸", "导入", "区别", "联系", "应用", "使用要求", "构成要件", "表现形式", "地域概念", "国民概念", "核心指标", "基本组成单位"}
GENERIC.update({"性质", "组成与任期", "组成和任期", "重要职权", "职权", "任期", "基本形式", "认定", "条件", "程序", "适用对象", "处罚", "特征", "本质"})
GENERIC.update({"主要内容", "实施", "原因", "后果", "原则", "类别", "基本要求", "一般要求", "要求", "适用", "适用范围", "主要表现"})
PREDICATE = re.compile(r"是|指|包括|分为|属于|称为|称作|位于|始于|终于|标志|发现|提出|建立|形成|发生|产生|具有|享有|承担|构成|决定|影响|体现|反映|实行|担任|主张|负责|创作|著有|出版|规定|不得|可以|应当|必须|需要|不能|增加|减少|下降|提高|导致|转化|转变|变化|成正比|成反比|相等|相同|相反|大于|小于|出土|诞生|来自|起源|组成|记载|上涨|降低|控制|实现|推行|设立|主导|占有|占据|居于|居住|流经|注入|面临|建立|代表|获得|授予|赢得|完成|达到|符合|设置|均为|有权|无权|有利于|不利于")
DEPENDENT = re.compile(r"^(?:是指|是|指|也是|也称|又称|又叫|被称|位于|创造了|出土文物|最大特色|主要表现|主要污染物|主要分布|主要包括|主要有|包括|分为|具有|由|始于|终于|作为|代表性遗址|其|该|这种|这一|它|其中|因此|所以|但是|而|以及|并且|并非|并不是|与|和|在中央|当地|往往|表示|用来|用于|可用于|能够|不能|可以|属于|负责|体现|反映|称为|称作|决定|影响)")
UNFINISHED = re.compile(r"(?:[，、：:；;（(]|是|为|指|的|与|和|或|由|即|包括|分为|在|把|被|将|以|对|及|从|等方面|在于|归结起来就是|主要有|如下|分别为|认为|指出|表明|提出|例如|如|其中|人民|发展阶|的新|依法|只转变|时期内|一定时期|条件下|情况下)$")

# These explicit joins were checked against the corresponding native page
# blocks. They recover important prerequisites/negations and source labels
# that share a PDF block or cannot be safely inferred from geometry alone.
REVISED_FACTS = {}


def revision(page, numbers, statement):
    for number in numbers:
        REVISED_FACTS[f"{page}-q{number:03d}"] = statement


revision("law-p004", [7], "动产物权变动：对于一般动产，其物权的设立和转让，自交付时发生效力。")
revision("law-p006", range(3, 10), "不能设立抵押的财产包括：土地所有权；宅基地、自留地、自留山等集体所有土地的使用权，但是法律规定可以抵押的除外；学校、幼儿园、医疗机构等为公益目的成立的非营利法人的教育设施、医疗卫生设施和其他公益设施；所有权、使用权不明或者有争议的财产；依法被查封、扣押、监管的财产；法律、行政法规规定不得抵押的其他财产。")
revision("law-p009", [22], "一方患有重大疾病的，应当在结婚登记前如实告知另一方。")
revision("politics-2-p011", [10, 11, 12], "全面深化改革开放必须以是否有利于坚持和改善D的全面领导、是否有利于坚持和完善中国特色社会主义制度为根本标准。")
revision("politics-2-p015", [1, 2], "政治建设的首要任务是保证全D服从中央，坚持D中央权威和集中统一领导。")
revision("politics-2-p015", [4, 5], "思想建设的根本任务是用D的创新理论武装全D。")
revision("economics-p003", [22], "GDP是计算期内生产的最终产品价值，因而是流量而不是存量。流量是一定时期内发生的变量，存量是一定时点上存在的变量。")
revision("economics-p004", [21], "菲利普斯曲线反映了失业率和通货膨胀率之间反向变动的关系。")
revision("marxism-p002", [16], "现代唯物主义（即辩证唯物主义和历史唯物主义）认为物质的唯一特性是客观实在性。")
revision("marxism-p016", [19], "使用价值和价值的对立，外在表现为商品和货币的对立。")
revision("history-p012", [11, 12], "都江堰是世界现存年代最久、唯一留存、仍在使用的无坝引水利工程。")
revision("history-p016", [9], "中共二大：会议通过了第一部《中国共产D章程》。")
revision("science-p004", [13], "沸腾需要具备达到沸点、继续吸热两个条件。")
revision("science-p022", [15], "¹³C/¹⁴C尿素呼气试验是现症感染诊断和根除后复查的“金标准”。")
revision("science-p023", [11], "空腹血糖是最基础的筛查指标，反映基础胰岛素分泌功能。")
revision("geography-p021", [17], "茶的分类包括绿茶、白茶、黄茶、红茶、乌龙茶、黑茶、再加工茶；国际茶日为5月21日。")
revision("law-p036", [13, 14], "行政许可可以撤销的情形包括：许可机关滥用职权、玩忽职守、超越职权或违反法定程序；对不具备申请资格或者不符合法定条件的申请人准予行政许可。撤销许可可能对公共利益造成重大损害的，不予撤销。")
revision("law-p036", [15, 16, 17, 18, 19, 20], "被许可人以欺骗、贿赂等不正当手段取得的行政许可，应当撤销；取得的行政许可属于直接关系公共安全、人身健康、生命财产安全事项的，申请人在3年内不得再次申请该行政许可。撤销许可可能对公共利益造成重大损害的，不予撤销。")
revision("law-p039", [11], "对依法应当复议前置的情形，申请人应当先向行政复议机关申请行政复议，对行政复议决定不服的，可以再依法向人民法院提起行政诉讼。")
revision("law-p013", [12, 13, 14], "无民事行为能力人在幼儿园、学校或者其他教育机构学习、生活期间受到人身损害的，幼儿园、学校或者其他教育机构应当承担责任；但能够证明尽到教育、管理职责的，不承担责任。此时教育机构承担过错推定责任。")
revision("politics-2-p004", [6, 7], "国有企业是中国特色社会主义的重要物质基础和政治基础，是我们D执政兴国的重要支柱和依靠力量。")
revision("law-p033", [23], "不予行政处罚的情形包括：不满14周岁或精神病人、智力残疾人在不能辨认或者不能控制自己行为时违法。")
revision("law-p015", [11], "我国公民在我国领域外犯罪，最高刑为3年以下有期徒刑的，可以不予追究；国家工作人员和军人一律追究。")
revision("law-p026", [4, 5], "一般累犯是指被判处有期徒刑以上刑罚的犯罪分子，刑罚执行完毕或者赦免以后，在5年内再犯应当判处有期徒刑以上刑罚之罪的犯罪分子。")
revision("law-p026", [6], "特别累犯是指危害国家安全犯罪、恐怖活动犯罪、黑社会性质的组织犯罪的犯罪分子，刑罚执行完毕或者赦免以后，在任何时候再犯上述任一类罪。")
revision("law-p010", [4], "协议离婚冷静期届满后30日内，双方应当亲自到婚姻登记机关申请发给离婚证；未申请的，视为撤回离婚登记申请。")
PREFIXES_BY_QUESTION = {
    "history-p020-q007": "平型关大捷", "history-p020-q008": "平型关大捷",
    "science-p004-q021": "沸腾",
}
EXCLUDE_DAILY = {"law-p003-q002", "law-p003-q011"}


def compact(text):
    return re.sub(r"\s+", "", text or "").strip()


def remove_number(text):
    text = re.sub(r"^(?:[①-⑳]+|\d+[.．、]|[一二三四五六七八九十]+[、．]|（[一二三四五六七八九十]+）)", "", compact(text))
    return text.replace("【知识延伸】", "").replace("【导入】", "").strip("：:。 ")


def is_label(text):
    text = remove_number(text)
    core = re.sub(r"[（(][^）)]*[）)]", "", text)
    return 1 <= len(core) <= 35 and len(text) <= 65 and not re.search(r"[，；。！？]|是|不能|应当|必须|可以|位于|发现|始于|终于", core) and not re.search(r"\d{3,}", core)


def rows(nodes):
    # The same baseline criterion used by import_knowledge.visual_rows, without
    # importing rendering/OCR dependencies just to rebuild this small index.
    result = []
    for node in sorted(nodes, key=lambda n: (n["bbox"][1], n["bbox"][0])):
        x, y, width, height = node["bbox"]
        best, overlap_best = None, 0
        for row in result:
            ry, rh = row["top"], row["bottom"] - row["top"]
            overlap = max(0, min(y + height, ry + rh) - max(y, ry)) / min(height, rh)
            difference = abs(y + height / 2 - (ry + rh / 2))
            if overlap >= .47 and difference <= max(height, rh) * .55 and overlap > overlap_best:
                best, overlap_best = row, overlap
        if best is None:
            result.append({"top": y, "bottom": y + height, "nodes": [node]})
        else:
            best["nodes"].append(node)
            best["top"] = sum(n["bbox"][1] for n in best["nodes"]) / len(best["nodes"])
            best["bottom"] = sum(n["bbox"][1] + n["bbox"][3] for n in best["nodes"]) / len(best["nodes"])
    for row in result:
        row["nodes"].sort(key=lambda n: n["bbox"][0])
    return sorted(result, key=lambda row: row["top"])


def block_text(block, nodes_by_id):
    source_nodes = [nodes_by_id[nid] for nid in block["nodeIds"] if nid in nodes_by_id]
    lines = rows(source_nodes)
    result = []
    for line in lines:
        text, previous = "", None
        for node in line["nodes"]:
            # Large spaces represent a branch label followed by its value.
            # Preserve this distinction as punctuation rather than flattening
            # labels into the middle of an otherwise readable sentence.
            gap = node["bbox"][0] - previous["bbox"][0] - previous["bbox"][2] if previous else 0
            if previous and gap > max(8, node["fontSize"] * 1.15):
                text += "："
            text += node["text"]
            previous = node
        result.append(text)
    return compact("".join(result))


def prepare_blocks(page):
    native = {n["id"]: n for n in page["nodes"] if n.get("sourceKind") != "ocr" and n.get("role") == "content"}
    records = []
    for order, block in enumerate(page["blocks"]):
        if block.get("sourceKind") == "ocr":
            continue
        text = block_text(block, native)
        if not text or text.isdigit():
            continue
        ids = [nid for nid in block["nodeIds"] if nid in native]
        records.append({**block, "text": text, "nodeIds": ids, "_order": order, "_lineHeight": min(native[nid]["fontSize"] for nid in ids)})
    # Some narrow map labels wrap into adjacent PDF blocks (民事权利 / 能力).
    # Merge only text fragments occupying the same narrow column.
    merged, consumed = [], set()
    for i, block in enumerate(records):
        if i in consumed:
            continue
        combined = dict(block)
        x, y, w, h = combined["bbox"]
        last_merged = i
        for j in range(i + 1, min(i + 4, len(records))):
            if j != last_merged + 1:
                break
            other = records[j]
            ox, oy, ow, oh = other["bbox"]
            line_height = max(combined["_lineHeight"], other["_lineHeight"])
            tight_wrap = 0 <= oy - y - h <= line_height * .85 and abs(ox-x) <= line_height * 1.75
            label_wrap = len(other["text"]) <= 9 and len(combined["text"]) <= 22 and is_label(combined["text"]) and is_label(other["text"]) and abs((ox + ow/2) - (x+w/2)) < line_height * 1.3 and 0 <= oy-y-h <= line_height*.85
            body_wrap = tight_wrap and not re.match(r"^(?:[①-⑳]|\d+[.．、])", other["text"]) and not re.search(r"[。！？]$", combined["text"])
            next_continues = re.match(r"^(?:并且|但是|但由于|但轻信|而|以及|同时|其合成|这一部分|又|也可以|或呈|所拥有|运用生产要素|经过中国)", other["text"])
            incomplete_wrap = (UNFINISHED.search(combined["text"]) or next_continues) and 0 <= oy-y-h <= line_height*2.5 and abs(ox-x) <= line_height*1.5 and not re.match(r"^(?:[①-⑳]|\d+[.．、])", other["text"]) and len(combined["text"]+other["text"]) <= 300
            if j not in consumed and (label_wrap or body_wrap or incomplete_wrap):
                combined["text"] += other["text"]
                combined["nodeIds"] = combined["nodeIds"] + other["nodeIds"]
                combined["bbox"] = [min(x, ox), y, max(x+w, ox+ow)-min(x, ox), oy+oh-y]
                x, y, w, h = combined["bbox"]
                last_merged = j
                consumed.add(j)
        merged.append(combined)
    return merged


def parent_label(block, blocks):
    x, y, width, height = block["bbox"]
    center = y + height / 2
    candidates = []
    for candidate in blocks:
        cx, cy, cw, ch = candidate["bbox"]
        heading = remove_number(candidate["text"].split("：", 1)[0])
        inline_label = "：" in candidate["text"] and is_label(heading)
        extended_label = len(candidate["text"]) <= 110 and re.match(r"^(?:第一步|第二步|到2035年|含义)", candidate["text"])
        if candidate is block or candidate["_order"] >= block["_order"] or cx >= x - 25 or cx + cw >= x - 5 or not (is_label(candidate["text"]) or extended_label or inline_label):
            continue
        # Prefer the immediately preceding map column. Labels in that column
        # are vertically centred between their branch's content lines.
        distance = abs(cy + ch/2 - center)
        if distance <= 190:
            candidates.append(candidate)
    if not candidates:
        return ""
    nearest_column = max(candidate["bbox"][0] for candidate in candidates)
    same_column = [candidate for candidate in candidates if nearest_column-candidate["bbox"][0] <= block["_lineHeight"]*3]
    # PDF blocks are emitted in the source map's branch order: the latest label
    # in the nearest left column is the current branch. Centre distance alone
    # can incorrectly assign a branch's top line to the preceding branch.
    candidate = max(same_column, key=lambda candidate: candidate["_order"])
    label = remove_number(candidate["text"].split("：", 1)[0])
    if label in GENERIC:
        ancestor = parent_label(candidate, blocks)
        if not ancestor and blocks and re.match(r"^(?:[一二三四五六七八九十]+、|知识点\d+)", blocks[0]["text"]):
            ancestor = re.sub(r"^知识点\d+", "", remove_number(blocks[0]["text"]))
        return ancestor or ""
    return label


def readable(block, blocks):
    text = remove_number(block["text"])
    if not text:
        return ""
    if "：" in text:
        head, tail = text.rsplit("：", 1)
        if re.search(r"是|构成|具有|包括|属于", head) and is_label(tail):
            text = head
    needs_context = DEPENDENT.match(text) or re.match(r"^(?:[\d（(]|基本|主要|最大|最低|最高|内容|号|世称|原名|字[\u4e00-\u9fff]|东晋书法家|战国问世|战国时期|常温|代表作|首创|首次|在生物|即|以生产资料|以劳动力|因货币|所拥有|运用生产要素|当潮湿|冷、暖|也可以|表现为|淋巴细胞|白细胞|中性粒细胞|不利于|有利于|实现|建成|基本实现|构建|推动|完善|共同构成|会议|行为人|表现较为|历史地位|可溶性岩石|我国典型代表|红色陆相碎屑岩|对这一问题)", text)
    if "之比" in text.split("。", 1)[0]:
        needs_context = True
    first_clause = text.split("，", 1)[0]
    if "，" in text and "：" not in first_clause and len(first_clause) < 35 and not PREDICATE.search(first_clause):
        needs_context = True
    if re.match(r"^(?:为从事|在一定|当利率|当税率)", text):
        needs_context = True
    if "：" in text and remove_number(text.split("：", 1)[0]) in GENERIC:
        needs_context = True
    if not PREDICATE.search(text) and "、" in text:
        needs_context = True
    # A source map's time-bound target is only meaningful with its left branch.
    if block["id"].startswith("politics-1-p007"):
        needs_context = True
    subject = parent_label(block, blocks) if needs_context else ""
    if re.match(r"^[^：，。；\d]{2,35}是", text) and not DEPENDENT.match(text) and not re.match(r"^(?:历史地位|对这一问题)", text):
        subject = ""
    if subject and (subject not in text or len(subject) < 3 and not text.startswith(subject)):
        if text.startswith(("是", "指", "位于", "具有", "包括", "分为", "属于", "始于", "终于")) and not re.search(r"[，：]", subject):
            text = subject + text
        elif subject.endswith(("是", "如下", "条件下")):
            text = subject + text
        else:
            text = subject + "：" + text
    for before, after in (("所在凡认为", "所在。凡认为"), ("测量也可以", "测量；也可以"), ("合作同时保持", "合作；同时保持"), ("出来这一部分", "出来。这一部分"), ("存量流量是", "存量。流量是")):
        text = text.replace(before, after)
    return text.rstrip("。") + "。"


def complete_fact(statement):
    text = statement.rstrip("。")
    if len(text) < 15 or len(text) > 300 or "____" in text or "\ufffd" in text:
        return False
    if UNFINISHED.search(text) or DEPENDENT.match(text) or re.match(r"^(?:也可以|即|因|自己的|以生产资料|所拥有|运用生产要素|表现为|导致|代表|内容|号|世称|东晋书法家|战国问世|战国时期|常温常压下|在生物|（\d{4})", text):
        return False
    # A missing half of a wrapped sentence must never be presented as a fact.
    for a, b in (("（", "）"), ("(", ")"), ("《", "》"), ("“", "”")):
        if text.count(a) != text.count(b):
            return False
    if re.match(r"^(?:第[一二三四五六七八九十]+[章节]|知识点\d+)", text):
        return False
    if "：" in text:
        subject, content = text.split("：", 1)
        if len(subject) >= 2 and len(content) >= 10 and (PREDICATE.search(content) or "、" in content):
            return True
    return bool(PREDICATE.search(text))


def collect_fact(daily, module, page, statement, source, qids, verified=False):
    if not verified and not complete_fact(statement):
        return
    # Preserve numbers, decimal points, ratios, signs and percentages: 1:2 is
    # a different assertion from 12, and 2.5 is different from 25.
    key = unicodedata.normalize("NFKC", re.sub(r"[①-⑳]", "", statement)).casefold()
    key = re.sub(r"[\s，,。；;、（）()“”‘’\"'！？!?…]", "", key)
    if key not in daily:
        daily[key] = {"id": "kp-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:20], "module": module, "title": page["title"], "statement": statement, "source": source, "questionIds": []}
    daily[key]["questionIds"].extend(qid for qid in qids if qid not in daily[key]["questionIds"])


def build_library(directory=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    directory = Path(directory) if directory is not None else DATA
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    points, daily = [], {}
    source_records = []
    for book in manifest["books"]:
        for info in book["pages"]:
            path = directory / "pages" / book["id"] / (info["id"] + ".json")
            page = json.loads(path.read_text(encoding="utf-8"))
            blocks = prepare_blocks(page)
            by_node = {nid: b for b in blocks for nid in b["nodeIds"]}
            source = {"file": book["source"]["file"], "page": page["number"], "title": book["title"]}
            module = book["category"]
            questions_by_block = {}
            list_groups = {}
            for question in page["questions"]:
                related = []
                for nid in question["nodeIds"]:
                    if nid in by_node and by_node[nid] not in related:
                        related.append(by_node[nid])
                statement = "".join(readable(block, blocks) for block in related) or question["answer"]
                points.append({"id": question["id"], "pageId": page["id"], "bookId": book["id"], "module": module, "title": page["title"], "prompt": question["context"], "statement": statement, "answer": question["answer"], "aliases": question.get("aliases", []), "source": source})
                source_records.append([question["id"], question["answer"], question["context"], statement])
                for block in related:
                    questions_by_block.setdefault(block["id"], []).append(question["id"])
            for block in blocks:
                qids = questions_by_block.get(block["id"], [])
                if not qids:
                    continue
                original = remove_number(block["text"])
                if any(qid in EXCLUDE_DAILY for qid in qids):
                    continue
                revised = next((REVISED_FACTS[qid] for qid in qids if qid in REVISED_FACTS), None)
                if revised:
                    collect_fact(daily, module, page, revised, source, qids, verified=True)
                    continue
                explicit_prefix = next((PREFIXES_BY_QUESTION[qid] for qid in qids if qid in PREFIXES_BY_QUESTION), None)
                if explicit_prefix:
                    collect_fact(daily, module, page, explicit_prefix + "：" + original.rstrip("。") + "。", source, qids)
                    continue
                if original in GENERIC or original.startswith("共同构成"):
                    continue
                if not PREDICATE.search(original) and "、" in original and not re.search(r"[：，。；]|实现|建成|促进|发展|推动|推进|提高|增强|把|^以|^在|^坚持", original):
                    subject = parent_label(block, blocks)
                    if subject:
                        group = list_groups.setdefault(subject, {"items": [], "questionIds": []})
                        group["items"].append(original)
                        group["questionIds"].extend(qids)
                    continue
                if not PREDICATE.search(original) and not ("、" in original and len(original) >= 12):
                    continue
                # Highlighted chapter/branch names are valid fill-in questions
                # but are not, on their own, a daily knowledge proposition.
                strong_relation = re.search(r"是|指(?:在|由|的|自)|包括|分为|属于|具有|享有|承担|构成|决定|影响|体现|反映|规定|不得|可以|应当|必须|不能|导致|始于|终于|小于|大于|相等|成正比|成反比", original)
                if is_label(original) and not strong_relation and "、" not in original:
                    continue
                statement = readable(block, blocks)
                collect_fact(daily, module, page, statement, source, qids)
            for subject, group in list_groups.items():
                statement = subject + "：" + "、".join(group["items"]) + "。"
                collect_fact(daily, module, page, statement, source, group["questionIds"])
    version = hashlib.sha256(json.dumps([source_records, list(daily.values())], ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()[:20]
    (directory / "points.json").write_text(json.dumps({"version": 1, "sourceVersion": version, "points": points}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("points.json:", len(points), dict(Counter(p["module"] for p in points)), flush=True)
    (directory / "daily-points.json").write_text(json.dumps({"version": 1, "sourceVersion": version, "points": list(daily.values())}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("daily-points.json:", len(daily), dict(Counter(p["module"] for p in daily.values())), flush=True)
    return {"points": len(points), "dailyPoints": len(daily), "sourceVersion": version}


if __name__ == "__main__":
    build_library()
