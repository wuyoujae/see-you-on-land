import argparse
import hashlib
import json
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parent
DATA_JSON = ROOT / "current-affairs-data.json"
DATA_JS = ROOT / "current-affairs-data.js"
START_DATE = date(2026, 7, 1)
CHINA_TZ = timezone(timedelta(hours=8), name="Asia/Shanghai")
SOURCE_NAMES = [
    "新闻联播", "人民日报", "新华社", "半月谈", "求是", "光明日报",
    "南方周末", "学习强国", "中国政府网", "广东发布",
]
FETCH_CACHE = {}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
}

STOP_PHRASES = {
    "中国", "我国", "全国", "今日", "记者", "视频", "新闻", "最新", "举行",
    "发布", "工作", "进行", "推进", "发展", "表示", "报道", "关注", "关于",
    "来自", "一个", "一场", "多个", "这些", "如何", "为何", "持续", "进一步",
    "国家", "活动", "组织", "大会", "科学", "建设", "人民", "会见", "总统",
    "庆祝", "奋斗", "习近", "近平", "共产党",
    "人民日报", "新华社", "新闻联播", "光明日报", "中国政府网", "学习强国",
}

PREFERRED_TERMS = [
    "习近平", "中国共产党", "建党105周年", "习近平党建思想", "全面从严治党",
    "防汛救灾", "防汛抗旱", "抢险救援", "极端天气", "暴雨", "高温", "龙卷风",
    "高质量发展", "科技创新", "科技强国", "科技奖励大会", "两院院士大会", "人工智能",
    "中国经济", "经济发展", "乡村振兴", "文化中国", "粤港澳大湾区", "十五五",
    "中国式现代化", "教育科技人才", "民生保障", "生态保护", "安全生产",
    "共同体", "对外开放", "国际合作", "国家安全", "基层治理",
    "中美关系", "中朝关系", "中纳关系", "纳米比亚", "朝鲜", "航海日",
    "暑期文旅", "产业发展", "机器人", "消费", "就业", "教育", "科技", "经济",
]


def make_session():
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def fetch(session, url, timeout=22):
    if url in FETCH_CACHE:
        return FETCH_CACHE[url]
    last_error = None
    for attempt in range(3):
        try:
            response = session.get(url, timeout=timeout, allow_redirects=True)
            response.raise_for_status()
            if "text" in response.headers.get("content-type", "") or not response.encoding:
                response.encoding = response.apparent_encoding or "utf-8"
            result = (response.text, response.url)
            FETCH_CACHE[url] = result
            return result
        except requests.RequestException as error:
            last_error = error
            time.sleep(0.7 * (attempt + 1))
    raise last_error


def clean_title(value):
    title = re.sub(r"\s+", " ", str(value or "")).strip()
    title = re.sub(r"^(完整版\s*)?(\[视频\]|【视频】|视频丨|视频｜)\s*", "", title)
    title = re.sub(r"^[·•丨|]+\s*", "", title)
    return title.strip(" -_丨|")


def article(source, title, url, day):
    title = clean_title(title)
    junk_markers = ("版责编", "广告", "导读", "联系电话", "投稿邮箱", "版权声明")
    if len(title) < 6 or any(marker in title for marker in junk_markers) or not url.startswith(("http://", "https://")):
        return None
    return {
        "id": hashlib.sha1(f"{source}|{url}".encode("utf-8")).hexdigest()[:14],
        "source": source,
        "title": title,
        "url": url,
        "date": day.isoformat(),
    }


def dedupe(items):
    result = []
    seen = set()
    seen_titles = set()
    for item in items:
        if not item:
            continue
        key = (item["source"], item["url"].split("#")[0])
        if key in seen:
            continue
        title_key = (item["source"], re.sub(r"\s+", "", item["title"]))
        if title_key in seen_titles:
            continue
        seen.add(key)
        seen_titles.add(title_key)
        result.append(item)
    return result


def same_day_in_url(url, day):
    variants = {
        day.strftime("%Y%m%d"), day.strftime("%Y/%m/%d"),
        day.strftime("%Y%m/%d"), day.strftime("%Y-%m/%d"),
        day.strftime("%Y-%m-%d"),
    }
    return any(value in url for value in variants)


def extract_page_date(html):
    soup = BeautifulSoup(html, "html.parser")
    meta_names = {
        "pubdate", "publishdate", "publish_date", "date", "article:published_time",
        "og:published_time", "weibo:article:create_at", "publish-time",
    }
    for tag in soup.find_all("meta"):
        key = (tag.get("name") or tag.get("property") or "").lower()
        if key in meta_names:
            match = re.search(r"20\d{2}[-/]\d{1,2}[-/]\d{1,2}", tag.get("content", ""))
            if match:
                return match.group(0).replace("/", "-")
    text = soup.get_text(" ", strip=True)[:6000]
    match = re.search(r"(?:发布时间|发布日期|来源[^\d]{0,20})?\s*(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?", text)
    if match:
        return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    return ""


def anchors(html, base_url, min_length=6):
    soup = BeautifulSoup(html, "html.parser")
    result = []
    for link in soup.select("a[href]"):
        title = clean_title(link.get("title") or link.get_text(" ", strip=True))
        href = urljoin(base_url, link.get("href", ""))
        if len(title) >= min_length and href.startswith(("http://", "https://")):
            result.append((title, href))
    return result


def crawl_cctv(session, day):
    url = f"https://tv.cctv.com/lm/xwlb/day/{day:%Y%m%d}.shtml"
    html, final_url = fetch(session, url)
    items = []
    for title, href in anchors(html, final_url):
        if f"/{day:%Y/%m/%d}/" in href and "tv.cctv.com" in urlparse(href).netloc:
            items.append(article("新闻联播", title, href, day))
    return dedupe(items)


def crawl_newspaper(session, day, source, first_page):
    html, final_url = fetch(session, first_page)
    page_urls = {final_url}
    for _, href in anchors(html, final_url):
        node_match = re.search(r"/node_(\d+)\.html?$", href)
        if node_match and int(node_match.group(1)) <= 4 and same_day_in_url(href, day):
            page_urls.add(href)

    items = []
    for page_url in sorted(page_urls):
        page_html, page_final = fetch(session, page_url)
        for title, href in anchors(page_html, page_final):
            if same_day_in_url(href, day) and re.search(r"content_\d+\.(?:html?|htm)$", href):
                items.append(article(source, title, href, day))
    return dedupe(items)[:40]


def crawl_people(session, day):
    url = f"https://paper.people.com.cn/rmrb/pc/layout/{day:%Y%m}/{day:%d}/node_01.html"
    return crawl_newspaper(session, day, "人民日报", url)


def crawl_guangming(session, day):
    url = f"https://epaper.gmw.cn/gmrb/html/layout/{day:%Y%m}/{day:%d}/node_01.html"
    return crawl_newspaper(session, day, "光明日报", url)


def crawl_dated_links(session, day, source, seeds, domains):
    items = []
    fetched = 0
    last_error = None
    for seed in seeds:
        try:
            html, final_url = fetch(session, seed)
            fetched += 1
        except Exception as error:
            last_error = error
            continue
        for title, href in anchors(html, final_url):
            host = urlparse(href).netloc.lower()
            if any(host == domain or host.endswith(f".{domain}") for domain in domains) and same_day_in_url(href, day):
                items.append(article(source, title, href, day))
    if not fetched and last_error:
        raise last_error
    return dedupe(items)


def crawl_xinhua(session, day):
    return crawl_dated_links(session, day, "新华社", [
        "https://www.news.cn/", "https://www.news.cn/politicspro/",
        "https://www.news.cn/fortune/", "https://www.news.cn/local/",
        "https://www.news.cn/world/",
    ], {"news.cn", "xinhuanet.com"})[:60]


def crawl_qiushi(session, day):
    return crawl_dated_links(session, day, "求是", [
        "https://www.qstheory.cn/", "https://www.qstheory.cn/qsdt/",
        "https://www.qstheory.cn/qshyjx/",
    ], {"qstheory.cn", "qstheory.com"})


def crawl_xuexi(session, day):
    manifest_url = "https://www.xuexi.cn/lgdata/index.json"
    html, _ = fetch(session, manifest_url, timeout=35)
    manifest = json.loads(html)
    day_text = day.isoformat()
    items = []

    def visit(value):
        if isinstance(value, dict):
            title = value.get("title")
            extra = value.get("extra")
            if isinstance(title, dict) and isinstance(extra, dict):
                timestamp = str(extra.get("text", ""))
                if timestamp.startswith(day_text):
                    items.append(article("学习强国", title.get("text"), title.get("link", ""), day))
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(manifest.get("pageData", {}))
    return dedupe(items)[:60]


def crawl_candidates_by_page_date(session, day, source, seeds, domains, limit=70):
    candidates = []
    fetched = 0
    last_error = None
    for seed in seeds:
        try:
            html, final_url = fetch(session, seed)
            fetched += 1
        except Exception as error:
            last_error = error
            continue
        for title, href in anchors(html, final_url):
            host = urlparse(href).netloc.lower()
            if not any(host == domain or host.endswith(f".{domain}") for domain in domains):
                continue
            if href.lower().endswith((".jpg", ".png", ".pdf", ".zip")):
                continue
            if len(title) >= 8:
                candidates.append((title, href))

    if not fetched and last_error:
        raise last_error

    unique = []
    seen = set()
    for item in candidates:
        if item[1] not in seen:
            seen.add(item[1])
            unique.append(item)
    unique = unique[:limit]

    def inspect(candidate):
        title, href = candidate
        try:
            html, final_url = fetch(make_session(), href, timeout=16)
            if extract_page_date(html) == day.isoformat():
                return article(source, title, final_url, day)
        except Exception:
            return None
        return None

    items = []
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = [executor.submit(inspect, candidate) for candidate in unique]
        for future in as_completed(futures):
            item = future.result()
            if item:
                items.append(item)
    return dedupe(items)


def crawl_banyuetan(session, day):
    return crawl_candidates_by_page_date(session, day, "半月谈", [
        "http://www.banyuetan.org/", "http://www.banyuetan.org/byt/shizheng/index.html",
        "http://www.banyuetan.org/byt/jicengzhili/index.html",
    ], {"banyuetan.org"}, limit=55)


def crawl_infzm(session, day):
    return crawl_candidates_by_page_date(session, day, "南方周末", [
        "https://www.infzm.com/", "https://www.infzm.com/news.shtml",
    ], {"infzm.com"}, limit=48)


def crawl_gov(session, day):
    return crawl_candidates_by_page_date(session, day, "中国政府网", [
        "https://www.gov.cn/", "https://www.gov.cn/yaowen/liebiao/",
        "https://www.gov.cn/zhengce/zuixin/",
    ], {"gov.cn"}, limit=75)


def crawl_guangdong(session, day):
    return crawl_candidates_by_page_date(session, day, "广东发布", [
        "https://www.gd.gov.cn/gdywdt/", "https://www.gd.gov.cn/gdywdt/ttxw/",
        "https://www.gd.gov.cn/gdywdt/gdyw/",
    ], {"gd.gov.cn"}, limit=70)


CRAWLERS = [
    ("新闻联播", crawl_cctv), ("人民日报", crawl_people), ("新华社", crawl_xinhua),
    ("半月谈", crawl_banyuetan), ("求是", crawl_qiushi),
    ("光明日报", crawl_guangming), ("南方周末", crawl_infzm),
    ("学习强国", crawl_xuexi), ("中国政府网", crawl_gov),
    ("广东发布", crawl_guangdong),
]


def keyword_candidates(title):
    normalized = re.sub(r"[“”‘’【】《》\[\]（）()：:，,。.!！?？、丨|·—\-]+", " ", title)
    candidates = set(term for term in PREFERRED_TERMS if term in title)
    for segment in re.findall(r"[\u4e00-\u9fff]{4,24}", normalized):
        for length in range(3, min(7, len(segment) + 1)):
            for index in range(len(segment) - length + 1):
                term = segment[index:index + length]
                if term not in STOP_PHRASES and not any(term.startswith(stop) and len(term) <= len(stop) + 1 for stop in STOP_PHRASES):
                    candidates.add(term)
    return candidates


def rank_keywords(items):
    document_frequency = Counter()
    for item in items:
        document_frequency.update(keyword_candidates(item["title"]))

    preferred = [(term, document_frequency[term]) for term in PREFERRED_TERMS if document_frequency[term] >= 2]
    preferred.sort(key=lambda pair: (-pair[1], -len(pair[0]), pair[0]))
    repeated = [
        (term, count) for term, count in document_frequency.items()
        if count >= 2
        and term not in PREFERRED_TERMS
        and term not in STOP_PHRASES
        and term[0] not in "的了和与及在为把被向从"
        and term[-1] not in "的了和与及在为把被向从成"
    ]
    repeated.sort(key=lambda pair: (-pair[1], -len(pair[0]), pair[0]))
    selected = []
    pool = preferred if preferred else repeated
    for term, count in pool:
        if any(term in existing and existing_count >= count * 0.7 for existing, existing_count in selected):
            continue
        selected.append((term, count))
        if len(selected) == 8:
            break

    if not selected:
        selected = [("今日时政", len(items))]
    return selected


def decorate_day(day, items, statuses):
    source_counts = Counter(item["source"] for item in items)
    statuses = [
        {**status, "count": source_counts.get(status["source"], 0)}
        if status["status"] == "ok" else status
        for status in statuses
    ]
    ranked = rank_keywords(items)
    for item in items:
        item["keyword"] = next((term for term, _ in ranked if term in item["title"]), "综合时政")
    frequency = dict(ranked)
    items.sort(key=lambda item: (-frequency.get(item["keyword"], 0), item["source"], item["title"]))
    return {
        "date": day.isoformat(),
        "keyword": ranked[0][0],
        "keywords": [{"name": term, "count": count} for term, count in ranked],
        "articles": items,
        "sourceStatus": statuses,
    }


def crawl_day(day):
    all_items = []
    statuses = []
    for source, crawler in CRAWLERS:
        started = time.time()
        try:
            items = crawler(make_session(), day)
            all_items.extend(items)
            statuses.append({
                "source": source, "status": "ok", "count": len(items),
                "duration": round(time.time() - started, 1),
            })
            print(f"{day} {source}: {len(items)}")
        except Exception as error:
            statuses.append({
                "source": source, "status": "error", "count": 0,
                "duration": round(time.time() - started, 1),
                "message": clean_title(str(error))[:120],
            })
            print(f"{day} {source}: ERROR {error}")
    return decorate_day(day, dedupe(all_items), statuses)


def merge_refresh(old_day, new_day):
    if not old_day:
        return new_day
    old_by_source = {
        source: [item for item in old_day.get("articles", []) if item["source"] == source]
        for source in SOURCE_NAMES
    }
    new_by_source = {
        source: [item for item in new_day.get("articles", []) if item["source"] == source]
        for source in SOURCE_NAMES
    }
    merged = []
    statuses = []
    for status in new_day.get("sourceStatus", []):
        source = status["source"]
        keep_old = bool(old_by_source[source]) and (status["status"] == "error" or not new_by_source[source])
        if keep_old:
            merged.extend(old_by_source[source])
            statuses.append({**status, "status": "stale", "count": len(old_by_source[source])})
        else:
            merged.extend(new_by_source[source])
            statuses.append(status)
    return decorate_day(date.fromisoformat(new_day["date"]), dedupe(merged), statuses)


def load_payload():
    if DATA_JSON.exists():
        try:
            return json.loads(DATA_JSON.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"startDate": START_DATE.isoformat(), "sources": SOURCE_NAMES, "days": []}


def save_payload(payload):
    payload["generatedAt"] = datetime.now(CHINA_TZ).isoformat(timespec="seconds")
    payload["days"].sort(key=lambda item: item["date"])
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    DATA_JSON.write_text(encoded + "\n", encoding="utf-8")
    DATA_JS.write_text("window.CURRENT_AFFAIRS_DATA = " + encoded + ";\n", encoding="utf-8")


def date_range(start, end):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def parse_args():
    parser = argparse.ArgumentParser(description="抓取每日时政并生成网页数据")
    parser.add_argument("--date", help="单日，格式 YYYY-MM-DD；默认今天")
    parser.add_argument("--backfill", action="store_true", help="从 2026-07-01 补采到目标日期")
    parser.add_argument("--force", action="store_true", help="覆盖已经存在的日期")
    return parser.parse_args()


def main():
    args = parse_args()
    target = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else datetime.now(CHINA_TZ).date()
    if target < START_DATE:
        raise SystemExit(f"目标日期不能早于 {START_DATE}")

    payload = load_payload()
    existing = {item["date"]: item for item in payload.get("days", [])}
    dates = list(date_range(START_DATE, target)) if args.backfill else [target]
    for day in dates:
        if day.isoformat() in existing and not args.force:
            print(f"{day}: 已存在，跳过")
            continue
        refreshed = crawl_day(day)
        existing[day.isoformat()] = merge_refresh(existing.get(day.isoformat()), refreshed) if args.force else refreshed
        payload["days"] = list(existing.values())
        save_payload(payload)
    save_payload(payload)
    print(f"已生成 {DATA_JS.name}，共 {len(payload['days'])} 天")


if __name__ == "__main__":
    main()
