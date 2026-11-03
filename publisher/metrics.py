"""맨티스 전략비서 — 플랫폼 숫자 수집.

사용법:
  python publisher/metrics.py probe     # 지금 토큰으로 어떤 숫자를 받을 수 있는지 점검 → metrics/probe.json
토큰 값은 절대 출력·저장하지 않는다.
"""
import datetime as dt
import json
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
import platforms as P  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "metrics"
KST = dt.timezone(dt.timedelta(hours=9))
TIMEOUT = 60
REFERENCE_ACCOUNTS = ["iamtheserkan"]


def _get(url, **params):
    return P._check(requests.get(url, params=params, timeout=TIMEOUT))


def _try(results, key, fn):
    """fn() 을 실행해 성공/실패와 짧은 설명을 results[key] 에 남긴다."""
    try:
        detail = fn()
        results[key] = {"ok": True, "detail": detail}
    except Exception as e:  # noqa: BLE001
        results[key] = {"ok": False, "detail": str(e)[:300]}
    mark = "✓" if results[key]["ok"] else "✗"
    print(f"  {mark} {key}: {results[key]['detail']}", flush=True)
    return results[key]["detail"] if results[key]["ok"] else None


# ───────────────────────── 인스타 ─────────────────────────
def ig_token():
    """숫자 수집용 인스타 토큰. 발행용(IG_ACCESS_TOKEN)과 따로 받은 IG_INSIGHTS_TOKEN 이 있으면 그걸 쓴다."""
    for env in ("IG_INSIGHTS_TOKEN", "IG_ACCESS_TOKEN"):
        tok = os.environ.get(env, "").strip()
        if tok:
            return env, tok
    return None, ""


def probe_instagram():
    env, tok = ig_token()
    if not tok:
        return {"token": {"ok": False, "detail": "IG_INSIGHTS_TOKEN / IG_ACCESS_TOKEN 없음"}}
    B, r = P._ig_base(tok), {"token": {"ok": True, "detail": f"{env} 사용"}}
    uid = P.ig_me(tok)["user_id"]
    print(f"인스타그램 ({env})", flush=True)
    if B == P.FB_API:
        _try(r, "permissions", lambda: sorted(
            p["permission"] for p in _get(f"{B}/me/permissions", access_token=tok)["data"] if p["status"] == "granted"))
    media = _try(r, "media_list", lambda: [
        {k: m.get(k) for k in ("id", "timestamp", "media_type", "like_count", "comments_count")}
        for m in _get(f"{B}/{uid}/media", fields="id,timestamp,media_type,like_count,comments_count",
                      limit=3, access_token=tok)["data"]])
    if media:
        mid = media[0]["id"]
        for metric in ("reach", "views", "likes", "comments", "shares", "saved", "follows",
                       "profile_visits", "total_interactions"):
            _try(r, f"media_insight.{metric}", lambda m=metric: _get(
                f"{B}/{mid}/insights", metric=m, access_token=tok)["data"][0]["values"][0]["value"])
        _try(r, "comments", lambda: f"{len(_get(f'{B}/{mid}/comments', fields='id,text,username,timestamp', access_token=tok)['data'])}개 읽음")
    _try(r, "account.follower_count", lambda: _get(
        f"{B}/{uid}/insights", metric="follower_count", period="day", access_token=tok)["data"][0]["values"][-1])
    _try(r, "account.online_followers", lambda: len(_get(
        f"{B}/{uid}/insights", metric="online_followers", period="lifetime", access_token=tok)["data"][0]["values"]))
    for metric in ("reach", "views", "profile_views", "follows_and_unfollows", "accounts_engaged"):
        _try(r, f"account.{metric}", lambda m=metric: _get(
            f"{B}/{uid}/insights", metric=m, period="day", metric_type="total_value",
            access_token=tok)["data"][0].get("total_value"))
    for name in REFERENCE_ACCOUNTS:
        _try(r, f"business_discovery.{name}", lambda n=name: {
            k: v for k, v in _get(f"{B}/{uid}", access_token=tok, fields=(
                f"business_discovery.username({n}){{followers_count,media_count,"
                "media.limit(1){like_count,comments_count,timestamp}}"))["business_discovery"].items()
            if k in ("followers_count", "media_count")})
    return r


# ───────────────────────── 쓰레드 ─────────────────────────
def probe_threads():
    tok = os.environ.get("THREADS_ACCESS_TOKEN", "").strip()
    if not tok:
        return {"token": {"ok": False, "detail": "THREADS_ACCESS_TOKEN 없음"}}
    B, r = P.TH_API, {}
    print("쓰레드", flush=True)
    posts = _try(r, "post_list", lambda: [
        {k: t.get(k) for k in ("id", "timestamp")}
        for t in _get(f"{B}/me/threads", fields="id,timestamp", limit=3, access_token=tok)["data"]])
    if posts:
        tid = posts[0]["id"]
        _try(r, "post_insights", lambda: {
            d["name"]: d["values"][0]["value"] for d in _get(
                f"{B}/{tid}/insights", metric="views,likes,replies,reposts,quotes,shares",
                access_token=tok)["data"]})
        _try(r, "replies", lambda: f"{len(_get(f'{B}/{tid}/replies', fields='id,text,username,timestamp', access_token=tok).get('data', []))}개 읽음")
    _try(r, "account.followers_count", lambda: _get(
        f"{B}/me/threads_insights", metric="followers_count", access_token=tok)["data"][0].get("total_value"))
    return r


# ───────────────────────── 유튜브 ─────────────────────────
def probe_youtube():
    if not all(os.environ.get(k) for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN")):
        return {"token": {"ok": False, "detail": "YT_ 비밀값 없음"}}
    import youtube as Y
    yt, r = Y._client(), {}
    print("유튜브", flush=True)
    ch = _try(r, "channel_statistics", lambda: (lambda c: {
        "title": c["snippet"]["title"], **c["statistics"],
        "uploads": c["contentDetails"]["relatedPlaylists"]["uploads"]})(
        yt.channels().list(part="snippet,statistics,contentDetails", mine=True).execute()["items"][0]))
    if ch:
        vids = _try(r, "video_list", lambda: [
            i["contentDetails"]["videoId"] for i in yt.playlistItems().list(
                part="contentDetails", playlistId=ch["uploads"], maxResults=3).execute()["items"]])
        if vids:
            _try(r, "video_statistics", lambda: yt.videos().list(
                part="statistics", id=vids[0]).execute()["items"][0]["statistics"])
            _try(r, "comments", lambda: f"{len(yt.commentThreads().list(part='snippet', videoId=vids[0], maxResults=20).execute().get('items', []))}개 읽음")
    return r


# ───────────────────────── 틱톡 ─────────────────────────
def probe_tiktok():
    import tiktok as T
    if not T.has_tiktok():
        return {"token": {"ok": False, "detail": "TT_ 비밀값 없음"}}
    r = {}
    print("틱톡", flush=True)
    tok = _try(r, "token", lambda: T.access_token() and "갱신 성공")
    if tok:
        at = T.access_token()
        h = {"Authorization": f"Bearer {at}"}
        _try(r, "user_stats", lambda: T._check(requests.get(
            f"{T.API}/user/info/", params={"fields": "follower_count,likes_count,video_count"},
            headers=h, timeout=TIMEOUT))["data"]["user"])
        _try(r, "video_list", lambda: [
            {k: v.get(k) for k in ("id", "view_count", "like_count", "comment_count", "share_count")}
            for v in T._check(requests.post(
                f"{T.API}/video/list/", params={"fields": "id,view_count,like_count,comment_count,share_count"},
                json={"max_count": 3}, headers=h, timeout=TIMEOUT))["data"].get("videos", [])])
    return r


def cmd_probe():
    result = {"checked_at": dt.datetime.now(KST).isoformat(timespec="seconds")}
    for name, fn in [("instagram", probe_instagram), ("threads", probe_threads),
                     ("youtube", probe_youtube), ("tiktok", probe_tiktok)]:
        try:
            result[name] = fn()
        except Exception as e:  # noqa: BLE001
            result[name] = {"error": {"ok": False, "detail": str(e)[:300]}}
            print(f"✗ {name} 점검 중 오류: {e}", flush=True)
    OUT.mkdir(exist_ok=True)
    (OUT / "probe.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("저장: metrics/probe.json")
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "probe"
    sys.exit({"probe": cmd_probe}[mode]())
