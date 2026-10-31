"""틱톡 Content Posting API — 영상을 틱톡 '임시저장함(인박스)'에 올린다.

앱에서 알림을 눌러 트렌드 음악을 고르고 직접 게시하는 방식 (video.upload 스코프).
필요한 비밀값: TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_REFRESH_TOKEN
액세스 토큰은 24시간짜리라 매번 refresh token으로 새로 받는다.
refresh token이 새로 나오면 GH_TOKEN이 있을 때 GitHub 비밀값도 갱신한다.
"""
import os
import subprocess
from pathlib import Path

import requests

API = "https://open.tiktokapis.com/v2"
TIMEOUT = 60
CHUNK = 10 * 1024 * 1024


def has_tiktok():
    return all(os.environ.get(k) for k in ("TT_CLIENT_KEY", "TT_CLIENT_SECRET", "TT_REFRESH_TOKEN"))


def _check(r):
    try:
        d = r.json()
    except ValueError:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    err = d.get("error")
    if r.status_code >= 400 or (isinstance(err, dict) and err.get("code") not in (None, "ok")) \
            or (isinstance(err, str) and err):
        raise RuntimeError(f"HTTP {r.status_code}: {err if err else d}")
    return d


def _save_secret(name, value):
    if not os.environ.get("GH_TOKEN"):
        return False
    repo = os.environ.get("GITHUB_REPOSITORY", "bethementis/mentis-publisher")
    subprocess.run(["gh", "secret", "set", name, "--repo", repo], input=value.encode(), check=True)
    return True


def access_token():
    r = requests.post("https://open.tiktokapis.com/v2/oauth/token/", data={
        "client_key": os.environ["TT_CLIENT_KEY"].strip(),
        "client_secret": os.environ["TT_CLIENT_SECRET"].strip(),
        "grant_type": "refresh_token",
        "refresh_token": os.environ["TT_REFRESH_TOKEN"].strip(),
    }, timeout=TIMEOUT)
    d = r.json()
    if "access_token" not in d:
        raise RuntimeError(f"틱톡 토큰 갱신 실패: {d.get('error_description') or d.get('error') or d}")
    new_rt = d.get("refresh_token")
    if new_rt and new_rt != os.environ["TT_REFRESH_TOKEN"].strip():
        os.environ["TT_REFRESH_TOKEN"] = new_rt
        _save_secret("TT_REFRESH_TOKEN", new_rt)
    return d["access_token"]


def tt_me():
    tok = access_token()
    d = _check(requests.get(f"{API}/user/info/", params={"fields": "open_id,display_name"},
                            headers={"Authorization": f"Bearer {tok}"}, timeout=TIMEOUT))
    return {"username": d.get("data", {}).get("user", {}).get("display_name")}


def tt_upload_draft(video_path):
    """영상을 틱톡 인박스(임시저장)로 보낸다. 사용자가 앱 알림에서 마무리해서 게시."""
    tok = access_token()
    size = Path(video_path).stat().st_size
    chunk = size if size <= CHUNK else CHUNK
    count = max(1, size // chunk)
    init = _check(requests.post(f"{API}/post/publish/inbox/video/init/", json={
        "source_info": {"source": "FILE_UPLOAD", "video_size": size,
                        "chunk_size": chunk, "total_chunk_count": count}},
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json; charset=UTF-8"},
        timeout=TIMEOUT))["data"]
    url, pid = init["upload_url"], init["publish_id"]
    with open(video_path, "rb") as f:
        for i in range(count):
            start = i * chunk
            end = size - 1 if i == count - 1 else start + chunk - 1
            f.seek(start)
            body = f.read(end - start + 1)
            r = requests.put(url, data=body, headers={
                "Content-Type": "video/mp4", "Content-Length": str(len(body)),
                "Content-Range": f"bytes {start}-{end}/{size}"}, timeout=300)
            if r.status_code not in (200, 201, 206):
                raise RuntimeError(f"틱톡 영상 전송 실패 HTTP {r.status_code}: {r.text[:200]}")
    return {"publish_id": pid}
