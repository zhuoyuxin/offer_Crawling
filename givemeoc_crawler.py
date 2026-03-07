from __future__ import annotations

import argparse
import json
import logging
import random
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any
from urllib.parse import ParseResult, parse_qsl, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag


BASE_URL = "https://www.givemeoc.com/"
JSON_STRING_PATTERN = r'"(?:\\.|[^"\\])*"'
KNOWN_LABELS = [
    "公司名称",
    "公司",
    "工作地点",
    "地点",
    "招聘类型",
    "招聘对象",
    "目标候选人",
    "岗位",
    "职位",
    "进度",
    "状态",
    "截止日期",
    "截止",
    "更新时间",
    "更新日期",
    "修改时间",
]


@dataclass
class HeadTemplate:
    url: str
    method: str
    headers: dict[str, str]
    body: dict[str, str]


@dataclass
class CrawlStats:
    crawled_pages: int = 0
    parsed_records: int = 0
    saved_records: int = 0
    skipped_records: int = 0
    updated_records: int = 0
    stop_reason: str = "completed"


def pop_cookie_header(headers: dict[str, str]) -> str:
    cookie_value = headers.pop("cookie", None)
    if cookie_value is None:
        cookie_value = headers.pop("Cookie", "")
    return cookie_value


def parse_cookie_header(cookie_header: str) -> dict[str, str]:
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except Exception:
        return {}
    return {name: morsel.value for name, morsel in cookie.items()}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="GiveMeOC 招聘爬虫（基于 head.txt 的 admin-ajax 请求模板）")
    parser.add_argument(
        "--mode",
        choices=["stop_on_existing", "update_and_continue"],
        default="update_and_continue",
        help="抓取模式：stop_on_existing 或 update_and_continue",
    )
    parser.add_argument("--head-file", default="head.txt", help="请求模板文件路径")
    parser.add_argument("--db-path", default="data/jobs.db", help="SQLite 文件路径，默认 data/jobs.db")
    parser.add_argument("--recruitment-type", default="", help="请求参数 recruitment_type，默认 ")
    parser.add_argument("--max-pages", type=int, default=None, help="最大抓取页数（可选）")
    parser.add_argument("--start-page", type=int, default=1, help="start page, default 1")
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=8,
        help="基础分页间隔秒数（实际等待为该值上下随机 ±3 秒）",
    )
    parser.add_argument("--timeout", type=int, default=20, help="单次请求超时时间（秒）")
    parser.add_argument("--retries", type=int, default=3, help="单页请求失败重试次数")
    return parser.parse_args()


def find_matching_brace(text: str, start_index: int) -> int:
    depth = 0
    in_string = False
    escaped = False
    for index in range(start_index, len(text)):
        ch = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return index
    raise ValueError("无法在 head.txt 中匹配 headers 对象的大括号")


def extract_json_string(text: str, pattern: str, field_name: str) -> str:
    match = re.search(pattern, text, flags=re.S)
    if not match:
        raise ValueError(f"head.txt 中缺少 {field_name} 字段")
    return json.loads(match.group(1))


def extract_headers_literal(text: str) -> str:
    key_match = re.search(r'"headers"\s*:', text)
    if not key_match:
        raise ValueError('head.txt 中缺少 "headers" 字段')
    colon_index = text.find(":", key_match.start())
    open_brace_index = text.find("{", colon_index)
    if open_brace_index == -1:
        raise ValueError('head.txt 中 "headers" 字段格式错误')
    close_brace_index = find_matching_brace(text, open_brace_index)
    return text[open_brace_index : close_brace_index + 1]


def load_head_template(head_file: Path) -> HeadTemplate:
    raw_text = head_file.read_text(encoding="utf-8")
    url = extract_json_string(raw_text, rf"fetch\(\s*({JSON_STRING_PATTERN})\s*,", "fetch url")
    method = extract_json_string(raw_text, rf'"method"\s*:\s*({JSON_STRING_PATTERN})', "method").upper()
    body_text = extract_json_string(raw_text, rf'"body"\s*:\s*({JSON_STRING_PATTERN})', "body")

    headers_literal = extract_headers_literal(raw_text)
    headers_obj = json.loads(headers_literal)
    headers: dict[str, str] = {str(key): str(value) for key, value in headers_obj.items()}

    cookie_value = headers.get("cookie") or headers.get("Cookie")
    if not cookie_value:
        raise ValueError("head.txt 的 headers 中缺少 cookie，当前站点不带 cookie 无法获取数据")

    body_pairs = parse_qsl(body_text, keep_blank_values=True)
    body = {str(key): str(value) for key, value in body_pairs}

    if "paged" not in body:
        raise ValueError('head.txt 的 body 中缺少 "paged" 参数')
    if not method:
        raise ValueError("head.txt 的 method 为空")
    return HeadTemplate(url=url, method=method, headers=headers, body=body)


def request_page(
    session: requests.Session,
    template: HeadTemplate,
    page: int,
    timeout: int,
    retries: int,
) -> str:
    payload = dict(template.body)
    payload["paged"] = str(page)
    max_attempts = max(1, retries)
    last_error: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        try:
            response = session.request(
                method=template.method,
                url=template.url,
                headers=template.headers,
                data=payload,
                timeout=timeout,
            )
            response.raise_for_status()
            return response.text
        except Exception as exc:
            last_error = exc
            if attempt == max_attempts:
                break
            sleep_time = min(8.0, 1.2 * attempt)
            logging.warning("第 %s 页请求失败（第 %s/%s 次），%.1f 秒后重试：%s", page, attempt, max_attempts, sleep_time, exc)
            time.sleep(sleep_time)

    raise RuntimeError(f"第 {page} 页请求失败，已重试 {max_attempts} 次") from last_error


def compute_randomized_sleep_seconds(base_sleep: float) -> float:
    randomized = round(base_sleep + random.uniform(-3.0, 3.0), 1)
    return max(0.0, randomized)


def find_html_fragment(payload: Any) -> str | None:
    if isinstance(payload, str):
        stripped = payload.strip()
        if "<" in stripped and ">" in stripped:
            return stripped
        return None
    if isinstance(payload, dict):
        for key in ("html", "content", "template", "rendered", "results", "data"):
            if key in payload:
                value = find_html_fragment(payload[key])
                if value:
                    return value
        for value in payload.values():
            nested = find_html_fragment(value)
            if nested:
                return nested
        return None
    if isinstance(payload, list):
        for item in payload:
            nested = find_html_fragment(item)
            if nested:
                return nested
    return None


def parse_response_html(raw_text: str) -> str:
    stripped = raw_text.lstrip("\ufeff").strip()
    if not stripped:
        return ""
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            return stripped
        if isinstance(payload, dict) and payload.get("success") is False:
            error_message = extract_error_message(payload)
            raise RuntimeError(f"接口返回失败：{error_message}")
        html = find_html_fragment(payload)
        return html or ""
    return stripped


def extract_error_message(payload: dict[str, Any]) -> str:
    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("message", "msg", "error"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    if isinstance(data, str) and data.strip():
        return data.strip()
    for key in ("message", "msg", "error"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "请检查 cookie / nonce 是否有效，或账号权限是否满足访问条件"


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def safe_urlparse(url: str) -> ParseResult | None:
    try:
        return urlparse(url)
    except ValueError:
        return None


def absolute_url(href: str) -> str:
    candidate = href.strip()
    if not candidate:
        return ""
    try:
        return urljoin(BASE_URL, candidate)
    except ValueError:
        logging.warning("跳过非法链接：%s", candidate)
        return ""


def is_http_url(url: str) -> bool:
    parsed = safe_urlparse(url)
    if parsed is None:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def extract_post_id(url: str) -> str | None:
    parsed = safe_urlparse(url)
    if parsed is None:
        return None
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    query_match = re.search(r"(?:^|&)(?:p|id|post_id|company_id)=(\d+)(?:&|$)", parsed.query)
    if query_match:
        return query_match.group(1)

    path_candidates = re.findall(r"(\d+)", parsed.path)
    if path_candidates:
        return path_candidates[-1]
    return None


def normalize_data_id(value: Any) -> str:
    if value is None:
        return ""
    return normalize_text(str(value))


def extract_data_id_from_node(node: Tag) -> str:
    attr_candidates = ("data-id", "data-company-id", "data-company_id")

    for attr_name in attr_candidates:
        if node.has_attr(attr_name):
            data_id = normalize_data_id(node.get(attr_name))
            if data_id:
                return data_id

    for selector in ("[data-id]", "[data-company-id]", "[data-company_id]"):
        nested = node.select_one(selector)
        if not isinstance(nested, Tag):
            continue
        for attr_name in attr_candidates:
            if nested.has_attr(attr_name):
                data_id = normalize_data_id(nested.get(attr_name))
                if data_id:
                    return data_id
    return ""


def extract_label_from_text(full_text: str, labels: list[str]) -> str:
    for label in labels:
        pattern = rf"{re.escape(label)}\s*[:：]?\s*([^\n\r]+)"
        match = re.search(pattern, full_text)
        if not match:
            continue
        value = match.group(1).strip("：:|/- ")
        for stop_label in KNOWN_LABELS:
            if stop_label in value and stop_label != label:
                value = value.split(stop_label, 1)[0].strip("：:|/- ")
        return value
    return ""


def extract_label_value(node: Tag, labels: list[str]) -> str:
    full_text = node.get_text("\n", strip=True)
    value = extract_label_from_text(full_text, labels)
    if value:
        return normalize_text(value)

    for label in labels:
        label_node = node.find(string=re.compile(rf"^\s*{re.escape(label)}\s*[:：]?\s*$"))
        if label_node and getattr(label_node, "parent", None):
            parent = label_node.parent
            sibling_text = ""
            if parent.next_sibling:
                sibling_text = normalize_text(str(getattr(parent.next_sibling, "get_text", lambda **_: parent.next_sibling)()))
            if not sibling_text and isinstance(parent, Tag):
                sibling = parent.find_next_sibling()
                if isinstance(sibling, Tag):
                    sibling_text = normalize_text(sibling.get_text(" ", strip=True))
            if sibling_text:
                return sibling_text
    return ""


def find_detail_anchor(node: Tag) -> Tag | None:
    anchors = node.find_all("a", href=True)
    if not anchors:
        return None
    for anchor in anchors:
        href = absolute_url(anchor["href"])
        if not is_http_url(href):
            continue
        if extract_post_id(href):
            return anchor
    for anchor in anchors:
        href = absolute_url(anchor["href"])
        if not is_http_url(href):
            continue
        parsed = safe_urlparse(href)
        if parsed and "givemeoc.com" in parsed.netloc:
            return anchor
    for anchor in anchors:
        href = absolute_url(anchor["href"])
        if is_http_url(href):
            return anchor
    return None


def extract_title(node: Tag, detail_anchor: Tag | None) -> str:
    for selector in ("h1", "h2", "h3", "h4", ".entry-title", ".job-title", ".title"):
        title_node = node.select_one(selector)
        if isinstance(title_node, Tag):
            title = normalize_text(title_node.get_text(" ", strip=True))
            if title:
                return title
    if detail_anchor is not None:
        title = normalize_text(detail_anchor.get_text(" ", strip=True))
        if title:
            return title
    return ""


def extract_company(node: Tag) -> str:
    for selector in (".company-name", ".company", ".firm-name", ".recruit-company", ".listing-company"):
        company_node = node.select_one(selector)
        if isinstance(company_node, Tag):
            text = normalize_text(company_node.get_text(" ", strip=True))
            if text:
                return text
    return extract_label_value(node, ["公司名称", "公司"])


def parse_job_record(node: Tag, source_page: int, crawled_at: str) -> dict[str, str] | None:
    detail_anchor = find_detail_anchor(node)
    if detail_anchor is None:
        return None

    data_id = extract_data_id_from_node(node)
    if not data_id:
        logging.warning("跳过缺少 data-id 的记录（非表格解析）")
        return None

    detail_url = absolute_url(detail_anchor["href"])

    title = extract_title(node, detail_anchor)
    company_name = extract_company(node)
    position = extract_label_value(node, ["岗位", "职位"])
    location = extract_label_value(node, ["工作地点", "地点", "location", "Location"])
    recruitment_type = extract_label_value(node, ["招聘类型"])
    target_candidates = extract_label_value(node, ["招聘对象", "目标候选人"])
    progress_status = extract_label_value(node, ["进度", "状态"])
    deadline = extract_label_value(node, ["截止日期", "截止", "deadline", "Deadline"])
    update_time = extract_label_value(node, ["更新时间", "更新日期", "修改时间", "updated_at", "update time"])

    record = {
        "post_id": data_id,
        "data_id": data_id,
        "title": title,
        "company_name": company_name,
        "company_type": "",
        "location": location,
        "recruitment_type": recruitment_type,
        "target_candidates": target_candidates,
        "position": position,
        "progress_status": progress_status,
        "deadline": deadline,
        "update_time": update_time,
        "detail_url": detail_url,
        "notice_url": "",
        "company_size": "",
        "source_page": str(source_page),
        "crawled_at": crawled_at,
    }
    return record


def collect_candidate_nodes(soup: BeautifulSoup) -> list[Tag]:
    selectors = [
        ".company-item",
        ".job-item",
        ".recruit-item",
        ".listing-item",
        ".post-item",
        "article",
        "li",
        ".card",
        ".item",
    ]
    nodes: list[Tag] = []
    seen_ids: set[int] = set()

    for selector in selectors:
        for node in soup.select(selector):
            if not isinstance(node, Tag):
                continue
            anchor = find_detail_anchor(node)
            if anchor is None:
                continue
            node_id = id(node)
            if node_id in seen_ids:
                continue
            seen_ids.add(node_id)
            nodes.append(node)

    if nodes:
        return nodes

    for anchor in soup.find_all("a", href=True):
        if not isinstance(anchor, Tag):
            continue
        parent = anchor.find_parent(["article", "li", "div"]) or anchor
        parent_id = id(parent)
        if parent_id in seen_ids:
            continue
        seen_ids.add(parent_id)
        nodes.append(parent)
    return nodes


def row_is_non_data(cell_texts: list[str], row_text: str) -> bool:
    if not row_text:
        return True
    noisy_words = ["正在加载", "请进行登陆", "请开通OC会员", "未找到匹配", "前往开通"]
    if any(word in row_text for word in noisy_words):
        return True
    header_words = ["公司名称", "招聘类型", "招聘对象", "工作地点", "岗位", "投递进度", "截止日期"]
    if cell_texts and cell_texts[0] in ("公司名称", "公司"):
        return True
    if sum(1 for word in header_words if word in row_text) >= 3:
        return True
    return False


def extract_cell_text_by_class(row: Tag, class_candidates: list[str]) -> str:
    for class_name in class_candidates:
        cell = row.select_one(f".{class_name}")
        if isinstance(cell, Tag):
            text = normalize_text(cell.get_text(" ", strip=True))
            if text:
                return text
    return ""


def pick_row_field(
    row: Tag,
    cell_texts: list[str],
    class_candidates: list[str],
    fallback_index: int,
) -> str:
    value = extract_cell_text_by_class(row, class_candidates)
    if value:
        return value
    if len(cell_texts) > fallback_index:
        return cell_texts[fallback_index]
    return ""


def parse_table_records(soup: BeautifulSoup, page: int, crawled_at: str) -> list[dict[str, str]]:
    rows = soup.select("tbody tr")
    if not rows:
        rows = soup.find_all("tr")

    records: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, Tag):
            continue
        cells = row.find_all("td")
        if len(cells) < 6:
            continue

        cell_texts = [normalize_text(cell.get_text(" ", strip=True)) for cell in cells]
        row_text = " ".join(text for text in cell_texts if text)
        if row_is_non_data(cell_texts, row_text):
            continue

        all_links: list[tuple[str, str]] = []
        for anchor in row.find_all("a", href=True):
            href = absolute_url(anchor["href"])
            if not is_http_url(href):
                continue
            text = normalize_text(anchor.get_text(" ", strip=True))
            all_links.append((href, text))

        # 投递链接：crt-col-links 内的 .crt-link（排除 .crt-notice-link）
        apply_anchor = row.select_one(".crt-col-links a.crt-link:not(.crt-notice-link)")
        detail_url = absolute_url(apply_anchor["href"]) if apply_anchor and apply_anchor.has_attr("href") else ""

        # 招聘公告：crt-col-notice 内的 .crt-notice-link
        notice_anchor = row.select_one(".crt-col-notice a.crt-notice-link")
        notice_url = absolute_url(notice_anchor["href"]) if notice_anchor and notice_anchor.has_attr("href") else ""

        # fallback: 如果 CSS class 没匹配到，从所有链接里按文本兜底
        if not detail_url:
            for href, text in all_links:
                if extract_post_id(href):
                    detail_url = href
                    break
        if not detail_url:
            for href, text in all_links:
                lower_text = text.lower()
                if "投递" in text or "申请" in text or "apply" in lower_text:
                    detail_url = href
                    break
        if not detail_url and all_links:
            detail_url = all_links[0][0]

        company_name = pick_row_field(row, cell_texts, ["crt-col-company", "crt-col-company-name"], 0)
        company_type = pick_row_field(row, cell_texts, ["crt-col-type"], 1)
        recruitment_type = pick_row_field(row, cell_texts, ["crt-col-recruitment-type"], 3)
        target_candidates = pick_row_field(row, cell_texts, ["crt-col-target-candidates", "crt-col-target"], 4)
        location = pick_row_field(row, cell_texts, ["crt-col-location"], 5)
        position = pick_row_field(row, cell_texts, ["crt-col-position"], 6)
        progress_status = pick_row_field(row, cell_texts, ["crt-col-status", "crt-col-progress-status"], 7)
        update_time = pick_row_field(row, cell_texts, ["crt-col-update-time", "crt-col-modified-time"], 8)
        deadline = pick_row_field(row, cell_texts, ["crt-col-deadline"], 9)
        company_size = pick_row_field(row, cell_texts, ["crt-col-company-size"], 13)
        title = position or company_name

        data_id = extract_data_id_from_node(row)
        if not data_id:
            logging.warning("跳过缺少 data-id 的记录（公司：%s，页码：%s）", company_name or "未知", page)
            continue

        record = {
            "post_id": data_id,
            "data_id": data_id,
            "title": title,
            "company_name": company_name,
            "company_type": company_type,
            "location": location,
            "recruitment_type": recruitment_type,
            "target_candidates": target_candidates,
            "position": position,
            "progress_status": progress_status,
            "deadline": deadline,
            "update_time": update_time,
            "detail_url": detail_url,
            "notice_url": notice_url,
            "company_size": company_size,
            "source_page": str(page),
            "crawled_at": crawled_at,
        }
        records.append(record)
    return records


def normalize_and_deduplicate_page_records(records: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    deduplicated: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    skipped = 0

    for record in records:
        data_id = normalize_data_id(record.get("data_id") or record.get("post_id"))
        if not data_id:
            skipped += 1
            logging.warning("跳过缺少 data_id/post_id 的记录，无法写入数据库")
            continue

        if data_id in seen_ids:
            skipped += 1
            logging.warning("同页内检测到重复 data_id=%s，已忽略重复记录", data_id)
            continue

        normalized = dict(record)
        normalized["data_id"] = data_id
        normalized["post_id"] = data_id
        deduplicated.append(normalized)
        seen_ids.add(data_id)

    return deduplicated, skipped


def parse_page_records(raw_response: str, page: int) -> list[dict[str, str]]:
    html = parse_response_html(raw_response)
    if not html:
        return []

    soup = BeautifulSoup(html, "lxml")
    crawled_at = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")
    table_records = parse_table_records(soup, page, crawled_at)
    if table_records:
        return table_records

    candidate_nodes = collect_candidate_nodes(soup)
    records: list[dict[str, str]] = []

    for node in candidate_nodes:
        record = parse_job_record(node, page, crawled_at)
        if not record:
            continue
        records.append(record)
    return records


def load_existing_data_ids(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT data_id FROM jobs WHERE data_id <> ''").fetchall()
    existing_ids: set[str] = set()
    for (value,) in rows:
        normalized = normalize_data_id(value)
        if normalized:
            existing_ids.add(normalized)
    return existing_ids


def crawl_jobs(
    template: HeadTemplate,
    start_page: int,
    max_pages: int | None,
    sleep_seconds: float,
    timeout: int,
    retries: int,
    conn: sqlite3.Connection,
    mode: str,
) -> CrawlStats:
    session = requests.Session()
    runtime_headers = dict(template.headers)
    cookie_header = pop_cookie_header(runtime_headers)
    cookie_map = parse_cookie_header(cookie_header)
    if cookie_map:
        session.cookies.update(cookie_map)
    elif cookie_header:
        runtime_headers["cookie"] = cookie_header

    runtime_template = HeadTemplate(
        url=template.url,
        method=template.method,
        headers=runtime_headers,
        body=dict(template.body),
    )

    existing_ids_snapshot = load_existing_data_ids(conn)
    logging.info("已加载 data_id 快照：%s 条", len(existing_ids_snapshot))

    stats = CrawlStats()
    page = start_page
    while True:
        if max_pages is not None and page > max_pages:
            stats.stop_reason = "max_pages"
            logging.info("达到最大页数限制：%s", max_pages)
            break

        logging.info("抓取第 %s 页...", page)
        raw_response = request_page(session, runtime_template, page, timeout=timeout, retries=retries)
        page_records = parse_page_records(raw_response, page)
        if not page_records:
            if page == start_page:
                raise RuntimeError(f"起始页（第 {start_page} 页）未解析到招聘信息，请检查 head.txt 中 cookie/nonce 是否有效")
            stats.stop_reason = "empty_page"
            logging.info("第 %s 页无数据，结束分页抓取", page)
            break

        normalized_records, page_skipped = normalize_and_deduplicate_page_records(page_records)
        hit_ids = sorted({item["data_id"] for item in normalized_records if item["data_id"] in existing_ids_snapshot})
        total_count, saved_count, db_skipped = save_records_to_db(normalized_records, conn)

        stats.crawled_pages += 1
        stats.parsed_records += len(page_records)
        stats.saved_records += saved_count
        stats.skipped_records += page_skipped + db_skipped
        stats.updated_records += len(hit_ids)

        if mode == "update_and_continue" and hit_ids:
            for data_id in hit_ids:
                logging.info("检测到已存在 data_id=%s，已更新并继续抓取", data_id)

        logging.info(
            "第 %s 页写库完成：解析 %s 条，有效 %s 条，命中已存在 %s 条，跳过 %s 条，库内总数 %s 条",
            page,
            len(page_records),
            saved_count,
            len(hit_ids),
            page_skipped + db_skipped,
            total_count,
        )

        if mode == "stop_on_existing" and hit_ids:
            stats.stop_reason = "existing_hit"
            sample_ids = ",".join(hit_ids[:5]) if hit_ids else "无"
            logging.info(
                "stop_on_existing：第 %s 页命中已存在记录 %s 条（示例：%s），本页已保存，停止继续抓取",
                page,
                len(hit_ids),
                sample_ids,
            )
            break

        page += 1
        if sleep_seconds > 0:
            actual_sleep = compute_randomized_sleep_seconds(sleep_seconds)
            if actual_sleep > 0:
                logging.info("等待 %.1f 秒后继续下一页", actual_sleep)
                time.sleep(actual_sleep)

    return stats


JOB_COLUMNS = [
    "post_id",
    "data_id",
    "title",
    "company_name",
    "company_type",
    "location",
    "recruitment_type",
    "target_candidates",
    "position",
    "progress_status",
    "deadline",
    "update_time",
    "detail_url",
    "notice_url",
    "company_size",
    "source_page",
    "crawled_at",
]


def ensure_data_id_uniqueness(conn: sqlite3.Connection) -> None:
    duplicate = conn.execute(
        """
        SELECT data_id, COUNT(*) AS total
        FROM jobs
        GROUP BY data_id
        HAVING COUNT(*) > 1
        LIMIT 1
        """
    ).fetchone()
    if duplicate:
        raise RuntimeError(
            f"jobs 表存在重复 data_id（示例：{duplicate[0]!r}，数量：{duplicate[1]}），"
            "无法启用 data_id 唯一约束，请先清理重复数据"
        )


def open_database(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS jobs (
            post_id TEXT PRIMARY KEY,
            data_id TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            company_name TEXT NOT NULL DEFAULT '',
            company_type TEXT NOT NULL DEFAULT '',
            location TEXT NOT NULL DEFAULT '',
            recruitment_type TEXT NOT NULL DEFAULT '',
            target_candidates TEXT NOT NULL DEFAULT '',
            position TEXT NOT NULL DEFAULT '',
            progress_status TEXT NOT NULL DEFAULT '',
            deadline TEXT NOT NULL DEFAULT '',
            update_time TEXT NOT NULL DEFAULT '',
            detail_url TEXT NOT NULL DEFAULT '',
            notice_url TEXT NOT NULL DEFAULT '',
            company_size TEXT NOT NULL DEFAULT '',
            source_page TEXT NOT NULL DEFAULT '',
            crawled_at TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_company_position ON jobs(company_name, position)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_update_time ON jobs(update_time)")

    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()}
    new_columns = [
        ("company_type", "TEXT NOT NULL DEFAULT ''"),
        ("notice_url", "TEXT NOT NULL DEFAULT ''"),
        ("company_size", "TEXT NOT NULL DEFAULT ''"),
    ]
    for col_name, col_def in new_columns:
        if col_name not in existing_columns:
            conn.execute(f"ALTER TABLE jobs ADD COLUMN {col_name} {col_def}")
            logging.info("已为 jobs 表新增列：%s", col_name)

    ensure_data_id_uniqueness(conn)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_data_id_unique ON jobs(data_id)")
    return conn


def normalize_record_for_db(record: dict[str, str]) -> tuple[str, ...] | None:
    data_id = normalize_data_id(record.get("data_id") or record.get("post_id"))
    if not data_id:
        return None
    normalized: dict[str, str] = {}
    for column in JOB_COLUMNS:
        if column in {"post_id", "data_id"}:
            normalized[column] = data_id
            continue
        normalized[column] = normalize_text(record.get(column))
    return tuple(normalized[column] for column in JOB_COLUMNS)


def save_records_to_db(records: list[dict[str, str]], conn: sqlite3.Connection) -> tuple[int, int, int]:
    insert_sql = """
        INSERT INTO jobs (
            post_id,
            data_id,
            title,
            company_name,
            company_type,
            location,
            recruitment_type,
            target_candidates,
            position,
            progress_status,
            deadline,
            update_time,
            detail_url,
            notice_url,
            company_size,
            source_page,
            crawled_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
        ON CONFLICT(data_id) DO UPDATE SET
            data_id=excluded.data_id,
            title=excluded.title,
            company_name=excluded.company_name,
            company_type=excluded.company_type,
            location=excluded.location,
            recruitment_type=excluded.recruitment_type,
            target_candidates=excluded.target_candidates,
            position=excluded.position,
            progress_status=excluded.progress_status,
            deadline=excluded.deadline,
            update_time=excluded.update_time,
            detail_url=excluded.detail_url,
            notice_url=excluded.notice_url,
            company_size=excluded.company_size,
            source_page=excluded.source_page,
            crawled_at=excluded.crawled_at,
            updated_at=datetime('now', '+8 hours')
    """
    valid_rows = [row for row in (normalize_record_for_db(item) for item in records) if row]
    skipped = len(records) - len(valid_rows)

    if valid_rows:
        with conn:
            conn.executemany(insert_sql, valid_rows)

    total_count = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    return int(total_count), len(valid_rows), skipped


def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")

    head_file = Path(args.head_file)
    db_path = Path(args.db_path)

    if args.start_page < 1:
        raise ValueError("--start-page 必须是大于等于 1 的整数")
    if args.max_pages is not None and args.max_pages < 1:
        raise ValueError("--max-pages 必须是大于等于 1 的整数")
    if args.max_pages is not None and args.start_page > args.max_pages:
        raise ValueError("--start-page 不能大于 --max-pages")

    template = load_head_template(head_file)
    template.body["recruitment_type"] = args.recruitment_type
    logging.info("请求筛选：recruitment_type=%s", args.recruitment_type)
    logging.info("抓取范围：start_page=%s, max_pages=%s", args.start_page, args.max_pages if args.max_pages is not None else "不限")
    conn = open_database(db_path)
    try:
        stats = crawl_jobs(
            template=template,
            start_page=args.start_page,
            max_pages=args.max_pages,
            sleep_seconds=args.sleep_seconds,
            timeout=args.timeout,
            retries=args.retries,
            conn=conn,
            mode=args.mode,
        )
        total_count = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    finally:
        conn.close()

    logging.info(
        "写库模式：%s，抓取页数 %s，解析 %s 条，写入 %s 条，更新 %s 条，跳过 %s 条，停止原因 %s，库内总数 %s 条",
        args.mode,
        stats.crawled_pages,
        stats.parsed_records,
        stats.saved_records,
        stats.updated_records,
        stats.skipped_records,
        stats.stop_reason,
        total_count,
    )
    logging.info("已写入 SQLite：%s", db_path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        logging.basicConfig(level=logging.ERROR, format="[%(levelname)s] %(message)s")
        logging.error("执行失败：%s", exc)
        raise SystemExit(1)
