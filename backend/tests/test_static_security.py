"""静态文件服务安全测试(P0 前半):守护 SPA catch-all 的路径穿越修复。

守护提交:
- 76a8317(fix(security): P0 安全旁路修复):main.py 的 serve_frontend
  增加 _resolve() —— realpath 消解符号链接后校验公共前缀,封堵
  `..%2f..%2f` 等编码穿越任意读取(原可读出 backend/.env 与 JWT 私钥);
  symlink 逃逸同样被拒(先消解再比对前缀,而非先 join 再判断)
- API 前缀路由不落到 SPA fallback:`/api/*` 未知路径返回 404 JSON
  (不再回落到 index.html 200)

conftest 的 static_dir fixture 提供了静态目录(index.html / page.html /
dir/index.html / _next/chunk.js)与目录外的哨兵机密文件
(sentinel-secret,内容含 SECRET_KEY=leaked-if-you-see-this),
静态目录内的 link-to-sentinel symlink 指向它。
"""
import os

SENTINEL_MARKER = "leaked-if-you-see-this"


def _assert_no_leak(resp, sentinel_path):
    """断言响应体不含哨兵机密内容。"""
    with open(sentinel_path, "rb") as f:
        sentinel_content = f.read()
    body = resp.content
    assert sentinel_content not in body, f"机密文件内容泄漏: {resp.url}"
    assert SENTINEL_MARKER.encode() not in body
    assert b"SECRET_KEY" not in body


def _traversal_urls_to_sentinel(static_root, sentinel_path):
    """构造指向哨兵文件的穿越 URL 列表(相对 static_root 的真实 ../ 路径)。

    rel 是从 static_root 到哨兵的真实相对路径(含 .. 段),保证:
    - 修复前(裸 os.path.join + isfile)这些 URL 能真的读到哨兵 → 测试可杀变异;
    - 修复后(realpath + 前缀校验)被拒。
    `/` 编码为 %2f、`.` 编码为 %2e,防止任何中间层归一化点段。
    """
    rel = os.path.relpath(sentinel_path, static_root)
    # 前置确认:该相对路径在"旧逻辑"下确实能命中一个真实文件
    # (否则测试退化为打空路径,守护不到修复)
    assert os.path.isfile(os.path.join(static_root, rel)), (
        f"穿越目标应真实存在: {rel}"
    )
    assert rel.startswith(".."), "哨兵应位于静态目录外"
    return [
        "/" + rel.replace("/", "%2f"),
        "/" + rel.replace("../", "%2e%2e/").replace("/", "%2f"),
        "/dir/" + rel.replace("../", "%2e%2e%2f").replace("/", "%2f"),
    ]


def test_path_traversal_encoded_dots_blocked(client, static_dir):
    """`..%2f` 编码穿越不得泄漏静态目录外的哨兵机密。

    httpx 0.28 不会归一化 %2f/%2e,TestClient 直接传原始 URL 即可
    让编码路径原样到达服务端(已实验验证),无需绕过高层 API。
    """
    static_root, sentinel_path = static_dir
    urls = [
        *_traversal_urls_to_sentinel(static_root, sentinel_path),
        # 直达仓库根的 backend/.env 路径形态(P0 漏洞原始利用形态,同样不得泄漏)
        "/..%2f..%2f..%2fbackend%2f.env",
    ]
    for url in urls:
        resp = client.get(url, follow_redirects=False)
        assert resp.status_code in (200, 404), f"{url} → {resp.status_code}"
        _assert_no_leak(resp, sentinel_path)


def test_path_traversal_percent_2e_blocked(client, static_dir):
    """`%2e%2e/%2e%2e/` 变体(dots 也编码)不得泄漏哨兵内容。"""
    static_root, sentinel_path = static_dir
    for url in _traversal_urls_to_sentinel(static_root, sentinel_path):
        resp = client.get(url, follow_redirects=False)
        assert resp.status_code in (200, 404), f"{url} → {resp.status_code}"
        _assert_no_leak(resp, sentinel_path)


def test_symlink_escape_blocked(client, static_dir):
    """静态目录内的 symlink 指向目录外机密 → realpath 消解后必须拒绝。"""
    static_root, sentinel_path = static_dir
    # 前置确认:fixture 确实建了指向哨兵的 symlink(旧逻辑下能读到哨兵)
    link = os.path.join(static_root, "link-to-sentinel")
    assert os.path.islink(link), "conftest 应提供 link-to-sentinel symlink"
    assert os.path.realpath(link) == os.path.realpath(sentinel_path)
    assert os.path.isfile(link), "旧逻辑(不消解 symlink)下该链接应能命中真实文件"

    resp = client.get("/link-to-sentinel", follow_redirects=False)
    _assert_no_leak(resp, sentinel_path)
    # 且不得返回 200 + 哨兵内容(要么 404,要么落到 SPA index.html)
    if resp.status_code == 200:
        assert b"LAAA test index" in resp.content, (
            "200 必须是 SPA fallback 的 index.html,而不是别的文件"
        )


def test_static_normal_paths_served(client):
    """穿越防护不误伤:正常静态路径全部照常服务。"""
    # 根路径 → index.html
    resp = client.get("/", follow_redirects=False)
    assert resp.status_code == 200
    assert b"LAAA test index" in resp.content

    # 精确文件
    resp = client.get("/page.html", follow_redirects=False)
    assert resp.status_code == 200
    assert b"test page.html" in resp.content

    # 目录 → dir/index.html(Next.js 静态导出模式)
    resp = client.get("/dir", follow_redirects=False)
    assert resp.status_code == 200
    assert b"test dir/index" in resp.content

    # 尾斜杠变体 → 同样命中 dir/index.html
    resp = client.get("/dir/", follow_redirects=False)
    assert resp.status_code == 200
    assert b"test dir/index" in resp.content

    # 不存在的 SPA 路由 → 回落 index.html(客户端路由)
    resp = client.get("/oauth/authorize", follow_redirects=False)
    assert resp.status_code == 200
    assert b"LAAA test index" in resp.content


def test_api_prefix_returns_404(client):
    """`/api/*` 未知路径返回 404 JSON,绝不落到 SPA fallback。"""
    resp = client.get("/api/nonexistent", follow_redirects=False)
    assert resp.status_code == 404, resp.text
    assert resp.json() == {"detail": "Not found"}
    assert "text/html" not in resp.headers.get("content-type", "")


# ---------------------------------------------------------------------------
# X-Request-ID 白名单(批次 8 修复 10)
# ---------------------------------------------------------------------------

def test_request_id_valid_inbound_is_reused(client):
    """合法入站 X-Request-ID(字母/数字/连字符,≤64)原样回显,便于链路追踪。"""
    resp = client.get("/api/health", headers={"X-Request-ID": "trace-abc-123"})
    assert resp.headers.get("X-Request-ID") == "trace-abc-123"


def test_request_id_invalid_inbound_is_regenerated(client):
    """非法入站 ID(注入字符/超长/空)不透传,重新生成合法 UUID。

    该头会回显到响应并进入日志,放行任意内容等于给日志注入开后门。
    """
    for evil in (
        "bad id with spaces",
        "crlf-inject\r\nX-Fake: 1",
        "x" * 65,           # 超长
        "../../etc/passwd",
        "id\x00null",
    ):
        resp = client.get("/api/health", headers={"X-Request-ID": evil})
        got = resp.headers.get("X-Request-ID", "")
        # 重新生成的是 UUID 形态,且绝不等同于恶意入站值
        assert got != evil
        assert len(got) == 36 and got.count("-") == 4, (evil, got)


def test_request_id_generated_when_absent(client):
    """无入站头 → 生成 UUID 回显。"""
    resp = client.get("/api/health")
    got = resp.headers.get("X-Request-ID", "")
    assert len(got) == 36 and got.count("-") == 4, got
