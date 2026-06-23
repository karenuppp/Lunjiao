"""
批量访问 HTTP 流量包 → 解码 body → 输出 decoded.json。

用法:
    python fetch_decode.py

配置: 环境变量或脚本顶部 CONFIG 字典。
"""

from __future__ import annotations

import json
import re
import os
import sys
from base64 import b64decode, b32decode
from binascii import unhexlify, Error as BinasciiError
from gzip import decompress as gz_decompress
from math import log2
from urllib.parse import unquote
from pathlib import Path

import requests
from charset_normalizer import from_bytes

# ── 配置 ───────────────────────────────────────────────────
# TODO: 用户补充实际值
CONFIG = {
    # PostgreSQL 连接
    "db_url": os.getenv("DATABASE_URL", "postgresql://user:pass@host:5432/dbname"),
    "table_name": os.getenv("TABLE_NAME", "traffic_packets"),       # TODO
    "uri_column": os.getenv("URI_COLUMN", "http_uri"),              # TODO
    "id_column": os.getenv("ID_COLUMN", "id"),                      # TODO

    # 输出
    "output_dir": os.getenv("OUTPUT_DIR",
                            str(Path(__file__).resolve().parent.parent / "output")),

    # 请求
    "request_timeout": int(os.getenv("REQUEST_TIMEOUT", "30")),
}

# ── 解码管道 ────────────────────────────────────────────────

def decode_body(raw_bytes: bytes) -> dict:
    """对单条 HTTP body 执行完整解码管道，返回结果字典。"""
    chain: list[str] = []
    data = raw_bytes

    # L0: HTTP 传输层解压
    data, l0_chain = _http_decompress(data)
    chain.extend(l0_chain)

    # L1: 字符编码检测
    text = _charset_to_utf8(data, chain)
    if text is not None:
        return _readable(text, chain)

    # L2: 有限迭代解码
    data, l2_chain = _decode_layers(data)
    chain.extend(l2_chain)

    # L1': 解码后再试字符编码
    text = _charset_to_utf8(data, chain)
    if text is not None:
        return _readable(text, chain)

    # 不可读
    return {
        "decoded_text": None,
        "decode_chain": chain,
        "status": "unreadable",
        "hint": "",
    }


# ── L0: HTTP 传输解压 ──────────────────────────────────────

def _http_decompress(data: bytes) -> tuple[bytes, list[str]]:
    magic = data[:3]
    # gzip: 1F 8B
    if magic[:2] == b'\x1f\x8b':
        try:
            return gz_decompress(data), ["gzip"]
        except Exception:
            pass
    # zlib/deflate: 78 9C / 78 01 / 78 DA
    if magic[:2] in (b'\x78\x9c', b'\x78\x01', b'\x78\xda'):
        import zlib
        try:
            return zlib.decompress(data), ["zlib"]
        except Exception:
            pass
    # brotli: CE B2 CF
    if magic[:3] == b'\xce\xb2\xcf':
        try:
            import brotli
            return brotli.decompress(data), ["brotli"]
        except (ImportError, Exception):
            pass
    return data, []


# ── L1: 字符编码检测 ───────────────────────────────────────

def _charset_to_utf8(data: bytes, chain: list[str]) -> str | None:
    """尝试将字节转为 UTF-8 可读文本。返回 None 表示不可读。"""
    if len(data) == 0:
        return None

    # charset-normalizer 自动检测
    try:
        result = from_bytes(data).best()
        if result:
            text = str(result)
            if _printable_ratio(text) > 0.3:
                enc = (result.original_encoding or "").lower()
                if enc and enc not in ("utf-8", "utf8", "ascii", "utf_8"):
                    chain.append(f"{enc}→utf-8")
                return text
    except Exception:
        pass

    # 回退：强制尝试常见中文/东亚编码
    for enc in ["gbk", "gb2312", "gb18030", "big5", "shift-jis", "euc-jp", "euc-kr"]:
        try:
            text = data.decode(enc)
            if _printable_ratio(text) > 0.3:
                chain.append(f"{enc}→utf-8")
                return text
        except Exception:
            continue

    return None


def _printable_ratio(text: str) -> float:
    if not text:
        return 0.0
    printable = sum(1 for c in text if c.isprintable() or c in ('\n', '\r', '\t'))
    return printable / len(text)


# ── L2: 有限迭代解码 ───────────────────────────────────────

def _decode_layers(data: bytes, max_rounds: int = 3) -> tuple[bytes, list[str]]:
    """
    迭代尝试解码，最多 max_rounds 轮。
    每轮依次尝试 base64 → hex → url-decode → base32。
    任一成功即进入下一轮，无变化则退出。
    """
    chain: list[str] = []

    for _ in range(max_rounds):
        changed = False
        for name, decoder, condition in DECODERS:
            if not condition(data):
                continue
            try:
                decoded = decoder(data)
                # 解码后必须有变化，且不能是空字节
                if decoded and decoded != data:
                    data = decoded
                    chain.append(name)
                    changed = True
                    break  # 成功后从头开始下一轮
            except Exception:
                continue

        if not changed:
            break

    return data, chain


# ── 解码器定义 ──────────────────────────────────────────────

def _try_b64(d: bytes) -> bytes:
    """Base64 解码，处理可能的 padding 缺失。"""
    stripped = d.strip()
    missing = len(stripped) % 4
    if missing:
        stripped += b'=' * (4 - missing)
    return b64decode(stripped, validate=True)


def _try_hex(d: bytes) -> bytes:
    """Hex 解码，先去除空白。"""
    return unhexlify(re.sub(rb'\s+', b'', d.strip()))


def _try_url(d: bytes) -> bytes:
    """URL 解码。"""
    return unquote(d.decode('ascii', errors='replace'), errors='replace').encode('latin-1')


def _try_b32(d: bytes) -> bytes:
    """Base32 解码。"""
    stripped = d.strip()
    missing = len(stripped) % 8
    if missing:
        stripped += b'=' * (8 - missing)
    return b32decode(stripped)


# ── 外观判断 ────────────────────────────────────────────────

def _is_base64(data: bytes) -> bool:
    stripped = data.strip()
    return len(stripped) > 0 and bool(
        re.match(rb'^[A-Za-z0-9+/=\s\n\r]+$', stripped)
    )


def _is_hex(data: bytes) -> bool:
    stripped = re.sub(rb'\s+', b'', data.strip())
    return len(stripped) > 0 and len(stripped) % 2 == 0 and bool(
        re.match(rb'^[0-9a-fA-F]+$', stripped)
    )


def _is_urlencoded(data: bytes) -> bool:
    try:
        text = data.decode('ascii')
    except UnicodeDecodeError:
        return False
    return '%' in text and len(text) > 2


def _is_base32(data: bytes) -> bool:
    stripped = data.strip()
    return len(stripped) > 0 and len(stripped) % 8 == 0 and bool(
        re.match(rb'^[A-Z2-7=\s]+$', stripped)
    )


DECODERS = [
    ("base64",     _try_b64,  _is_base64),
    ("hex",        _try_hex,  _is_hex),
    ("url-decode", _try_url,  _is_urlencoded),
    ("base32",     _try_b32,  _is_base32),
]

# ── 辅助函数 ────────────────────────────────────────────────

def _readable(text: str, chain: list[str]) -> dict:
    return {
        "decoded_text": text,
        "decode_chain": chain,
        "status": "readable",
        "hint": "",
    }

# ── 数据获取 ────────────────────────────────────────────────
# TODO: 用户提供 .http 页面 HTML 结构后，修改 extract_body 函数。

def fetch_http_page(uri: str, timeout: int = 30) -> str | None:
    """访问 .http 页面，返回原始 HTML 文本；失败返回 None。"""
    try:
        resp = requests.get(uri, timeout=timeout)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"[WARN] 请求失败 {uri}: {e}", file=sys.stderr)
        return None


def extract_body(html: str) -> bytes | None:
    """
    从 PHP 渲染的 .http 页面 HTML 中提取 body 原始字节。

    TODO: 用户提供样例页面后实现具体提取逻辑。
    常见模式（解除注释后使用）：
    """
    # 模式1: body 在 <pre class="body"> 中
    # match = re.search(r'<pre[^>]*class="[^"]*body[^"]*"[^>]*>(.*?)</pre>', html, re.DOTALL)
    # if match:
    #     return match.group(1).encode('latin-1')

    # 模式2: body 在 <code> 标签中
    # match = re.search(r'<code[^>]*>(.*?)</code>', html, re.DOTALL)
    # if match:
    #     return match.group(1).encode('latin-1')

    # 模式3: body 在特定的 <div> 中
    # match = re.search(r'<div[^>]*id="body"[^>]*>(.*?)</div>', html, re.DOTALL)
    # if match:
    #     return match.group(1).encode('latin-1')

    # 临时: 返回整个页面文本（等用户提供结构后替换）
    # ⚠️ 这只是兜底，会把 header 等其他信息也包含进去
    return html.encode('latin-1')


def query_uris(conn_url: str, table: str, uri_col: str, id_col: str) -> list[dict]:
    """从 PostgreSQL 查询所有流量包 URI。返回值: [{"id": ..., "uri": ...}, ...]"""
    try:
        import psycopg2
        conn = psycopg2.connect(conn_url)
        cur = conn.cursor()
        cur.execute(f'SELECT "{id_col}", "{uri_col}" FROM "{table}"')
        rows = cur.fetchall()
        conn.close()
        return [{"id": str(r[0]), "uri": str(r[1])} for r in rows]
    except ImportError:
        print("[ERROR] 需要安装 psycopg2: pip install psycopg2-binary", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] 数据库查询失败: {e}", file=sys.stderr)
        sys.exit(1)


# ── 主流程 ──────────────────────────────────────────────────

def main():
    cfg = CONFIG

    # 确保输出目录存在
    output_dir = Path(cfg["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. 查询数据库
    print(f"[INFO] 查询数据库 {cfg['table_name']}...", file=sys.stderr)
    rows = query_uris(cfg["db_url"], cfg["table_name"], cfg["uri_column"], cfg["id_column"])
    total = len(rows)
    print(f"[INFO] 共 {total} 条记录", file=sys.stderr)

    # 2. 逐条访问并解码
    results: list[dict] = []
    readable_count = 0

    for i, row in enumerate(rows):
        rid = row["id"]
        uri = row["uri"]

        if (i + 1) % 100 == 0:
            print(f"[INFO] 进度: {i + 1}/{total}", file=sys.stderr)

        # 访问 .http 页面
        html = fetch_http_page(uri, timeout=cfg["request_timeout"])
        if html is None:
            results.append({
                "id": rid, "uri": uri, "decoded_text": None,
                "decode_chain": [], "status": "fetch_failed", "hint": "页面请求失败",
            })
            continue

        # 提取 body
        raw_body = extract_body(html)
        if raw_body is None or len(raw_body) == 0:
            results.append({
                "id": rid, "uri": uri, "decoded_text": None,
                "decode_chain": [], "status": "unreadable", "hint": "body 为空",
            })
            continue

        # 解码管道
        result = decode_body(raw_body)
        result["id"] = rid
        result["uri"] = uri

        if result["status"] == "readable":
            readable_count += 1

        results.append(result)

    # 3. 输出
    output_path = output_dir / "decoded.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n[INFO] 完成: {total} 条, 可读 {readable_count}, "
          f"不可读 {total - readable_count}", file=sys.stderr)
    print(f"[INFO] 结果写入: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
