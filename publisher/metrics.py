"""맨티스 전략비서 — 플랫폼 숫자 수집.

사용법:
  python publisher/metrics.py collect   # 매일 수집 → metrics/YYYY-MM-DD.json
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


# ───────────────────────── 매일 수집 ─────────────────────────
HANDLE = "bethementis"
POST_DAYS = 30        # 최근 30일 게시물의 숫자를 매일 다시 잰다 (누적 추이용)
COMMENT_DAYS = 7      # 댓글은 최근 7일 게시물만 모은다 (답글 초안용)
IG_MEDIA_METRICS = ("reach", "views", "likes", "comments", "shares", "saved", "follows",
                    "profile_visits", "total_interactions")


def _recent(ts, days):
    t = dt.datetime.fromisoformat(ts.replace("+0000", "+00:00"))
    return t >= dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)


def _head(text, n=120):
    return (text or "").strip().replace("\n", " ")[:n]


def _yesterday_range():
    """한국시간 기준 어제 0시~오늘 0시 (unix)"""
    today = dt.datetime.now(KST).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((today - dt.timedelta(days=1)).timestamp()), int(today.timestamp())


def collect_instagram():
    env, tok = ig_token()
    if not tok:
        raise RuntimeError("IG_INSIGHTS_TOKEN / IG_ACCESS_TOKEN 없음")
    B = P._ig_base(tok)
    uid = P.ig_me(tok)["user_id"]
    out = {"token": env}
    out["account"] = {k: v for k, v in _get(f"{B}/{uid}", fields="followers_count,follows_count,media_count",
                                             access_token=tok).items() if k != "id"}
    since, until = _yesterday_range()
    day = {}
    for m in ("reach", "views", "profile_views", "accounts_engaged", "total_interactions"):
        try:
            d = _get(f"{B}/{uid}/insights", metric=m, period="day", metric_type="total_value",
                     since=since, until=until, access_token=tok)["data"]
            day[m] = d[0]["total_value"]["value"] if d else None
        except Exception as e:  # noqa: BLE001
            day[m] = None
            out.setdefault("errors", {})[f"account.{m}"] = str(e)[:200]
    out["account"]["yesterday"] = day
    try:   # 팔로워 100명 이상부터 제공
        d = _get(f"{B}/{uid}/insights", metric="online_followers", period="lifetime", access_token=tok)["data"]
        out["account"]["online_followers"] = d[0]["values"][-1]["value"] if d else None
    except Exception:  # noqa: BLE001
        out["account"]["online_followers"] = None

    posts, comments = [], []
    media = _get(f"{B}/{uid}/media", limit=25, access_token=tok,
                 fields="id,timestamp,permalink,media_type,caption,like_count,comments_count")["data"]
    for m in media:
        if not _recent(m["timestamp"], POST_DAYS):
            continue
        p = {k: m.get(k) for k in ("id", "timestamp", "permalink", "media_type", "like_count", "comments_count")}
        p["caption_head"] = _head(m.get("caption"))
        try:
            p["insights"] = {d["name"]: d["values"][0]["value"] for d in _get(
                f"{B}/{m['id']}/insights", metric=",".join(IG_MEDIA_METRICS), access_token=tok)["data"]}
        except Exception:  # noqa: BLE001 — 한 지표라도 안 되면 하나씩 다시
            p["insights"] = {}
            for metric in IG_MEDIA_METRICS:
                try:
                    p["insights"][metric] = _get(f"{B}/{m['id']}/insights", metric=metric,
                                                 access_token=tok)["data"][0]["values"][0]["value"]
                except Exception:  # noqa: BLE001
                    p["insights"][metric] = None
        posts.append(p)
        if _recent(m["timestamp"], COMMENT_DAYS) and m.get("comments_count"):
            for c in _get(f"{B}/{m['id']}/comments", access_token=tok,
                          fields="id,text,username,timestamp,replies{username,text,timestamp}")["data"]:
                replies = (c.get("replies") or {}).get("data", [])
                comments.append({"media_id": m["id"], "permalink": m.get("permalink"), "id": c["id"],
                                 "username": c.get("username"), "text": c.get("text"), "timestamp": c.get("timestamp"),
                                 "we_replied": any(r.get("username") == HANDLE for r in replies)})
    out["posts"], out["comments"] = posts, comments

    refs = []
    for name in REFERENCE_ACCOUNTS:
        try:
            bd = _get(f"{B}/{uid}", access_token=tok, fields=(
                f"business_discovery.username({name}){{followers_count,media_count,"
                "media.limit(12){timestamp,permalink,media_type,caption,like_count,comments_count}}"))["business_discovery"]
            refs.append({"username": name, "followers_count": bd.get("followers_count"),
                         "media_count": bd.get("media_count"),
                         "media": [{**{k: x.get(k) for k in ("timestamp", "permalink", "media_type",
                                                             "like_count", "comments_count")},
                                    "caption_head": _head(x.get("caption"))}
                                   for x in bd.get("media", {}).get("data", [])]})
        except Exception as e:  # noqa: BLE001
            refs.append({"username": name, "error": str(e)[:200]})
    out["reference"] = refs
    return out


def collect_threads():
    tok = os.environ.get("THREADS_ACCESS_TOKEN", "").strip()
    if not tok:
        raise RuntimeError("THREADS_ACCESS_TOKEN 없음")
    B, out = P.TH_API, {}
    fc = _get(f"{B}/me/threads_insights", metric="followers_count", access_token=tok)["data"]
    out["account"] = {"followers_count": fc[0].get("total_value", {}).get("value") if fc else None}
    posts, replies = [], []
    for t in _get(f"{B}/me/threads", fields="id,timestamp,permalink,text", limit=25, access_token=tok)["data"]:
        if not _recent(t["timestamp"], POST_DAYS):
            continue
        p = {k: t.get(k) for k in ("id", "timestamp", "permalink")}
        p["text_head"] = _head(t.get("text"))
        p["insights"] = {d["name"]: d["values"][0]["value"] for d in _get(
            f"{B}/{t['id']}/insights", metric="views,likes,replies,reposts,quotes,shares", access_token=tok)["data"]}
        posts.append(p)
        if _recent(t["timestamp"], COMMENT_DAYS) and p["insights"].get("replies"):
            for r in _get(f"{B}/{t['id']}/replies", fields="id,text,username,timestamp,has_replies",
                          access_token=tok).get("data", []):
                if r.get("username") == HANDLE:
                    continue
                replies.append({"post_id": t["id"], "permalink": t.get("permalink"),
                                **{k: r.get(k) for k in ("id", "username", "text", "timestamp", "has_replies")}})
    out["posts"], out["replies"] = posts, replies
    return out


def collect_youtube():
    if not all(os.environ.get(k) for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN")):
        raise RuntimeError("YT_ 비밀값 없음")
    import youtube as Y
    yt = Y._client()
    ch = yt.channels().list(part="statistics,contentDetails", mine=True).execute()["items"][0]
    out = {"channel": {k: int(v) for k, v in ch["statistics"].items() if v.isdigit()}}
    ids = [i["contentDetails"]["videoId"] for i in yt.playlistItems().list(
        part="contentDetails", playlistId=ch["contentDetails"]["relatedPlaylists"]["uploads"],
        maxResults=25).execute()["items"]]
    videos = []
    for v in (yt.videos().list(part="snippet,statistics", id=",".join(ids)).execute()["items"] if ids else []):
        if not _recent(v["snippet"]["publishedAt"].replace("Z", "+00:00"), POST_DAYS):
            continue
        videos.append({"id": v["id"], "title": v["snippet"]["title"], "published_at": v["snippet"]["publishedAt"],
                       "url": f"https://youtube.com/shorts/{v['id']}",
                       "statistics": {k: int(x) for k, x in v["statistics"].items() if x.isdigit()}})
    out["videos"] = videos
    return out


def collect_tiktok():
    import tiktok as T
    if not T.has_tiktok():
        raise RuntimeError("TT_ 비밀값 없음")
    h = {"Authorization": f"Bearer {T.access_token()}"}
    user = T._check(requests.get(f"{T.API}/user/info/", headers=h, timeout=TIMEOUT, params={
        "fields": "follower_count,following_count,likes_count,video_count"}))["data"]["user"]
    fields = "id,title,create_time,share_url,view_count,like_count,comment_count,share_count"
    vids = T._check(requests.post(f"{T.API}/video/list/", params={"fields": fields}, json={"max_count": 20},
                                  headers=h, timeout=TIMEOUT))["data"].get("videos", [])
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=POST_DAYS)).timestamp()
    return {"account": user, "videos": [v for v in vids if v.get("create_time", 0) >= cutoff]}


def cmd_collect():
    now = dt.datetime.now(KST)
    result = {"date": now.strftime("%Y-%m-%d"), "collected_at": now.isoformat(timespec="seconds"), "errors": {}}
    for name, fn in [("instagram", collect_instagram), ("threads", collect_threads),
                     ("youtube", collect_youtube), ("tiktok", collect_tiktok)]:
        try:
            result[name] = fn()
            n = len(result[name].get("posts", result[name].get("videos", [])))
            print(f"✓ {name}: 게시물 {n}개", flush=True)
        except Exception as e:  # noqa: BLE001
            result[name] = None
            result["errors"][name] = str(e)[:300]
            print(f"✗ {name}: {e}", flush=True)
    # 네이버 클립·샤오홍슈는 API가 없어 어사이드 루틴이 따로 채운다 (아직 연결 전)
    result["naver"] = result["xhs"] = None
    OUT.mkdir(exist_ok=True)
    (OUT / f"{result['date']}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장: metrics/{result['date']}.json")
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "probe"
    sys.exit({"probe": cmd_probe, "collect": cmd_collect}[mode]())
