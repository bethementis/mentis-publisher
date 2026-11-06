"""인스타그램 / 쓰레드 공식 API 호출 모음."""
import time
import requests

import os

IG_API = "https://graph.instagram.com/v23.0"
FB_API = "https://graph.facebook.com/v23.0"
# 메타 앱 대시보드에 표시된 @bethementis 인스타 계정 ID (페이스북 로그인 방식 토큰일 때 사용)
IG_USER_ID = os.environ.get("IG_USER_ID", "17841423316407295")
TH_API = "https://graph.threads.net/v1.0"
TIMEOUT = 60


class PublishError(Exception):
    pass


def _check(r):
    try:
        data = r.json()
    except ValueError:
        raise PublishError(f"HTTP {r.status_code}: {r.text[:300]}")
    if r.status_code >= 400 or "error" in data:
        err = data.get("error", data)
        msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
        raise PublishError(f"HTTP {r.status_code}: {msg}")
    return data


# ───────────────────────── Instagram ─────────────────────────
def _ig_base(token):
    """토큰 종류에 따라 API 주소가 다름: IGAA… = 인스타 로그인, EAA… = 페이스북(비즈니스) 로그인"""
    return FB_API if token.startswith("EAA") else IG_API


def ig_me(token):
    token = token.strip()
    base = _ig_base(token)
    if base == FB_API:
        d = _check(requests.get(f"{FB_API}/{IG_USER_ID}", params={
            "fields": "id,username", "access_token": token}, timeout=TIMEOUT))
        return {"user_id": d["id"], "username": d.get("username")}
    return _check(requests.get(f"{IG_API}/me", params={
        "fields": "user_id,username", "access_token": token}, timeout=TIMEOUT))


def _ig_wait(container_id, token, tries=30):
    for _ in range(tries):
        d = _check(requests.get(f"{_ig_base(token)}/{container_id}", params={
            "fields": "status_code,status", "access_token": token}, timeout=TIMEOUT))
        code = d.get("status_code")
        if code == "FINISHED":
            return
        if code in ("ERROR", "EXPIRED"):
            raise PublishError(f"컨테이너 {container_id} 실패: {d.get('status')}")
        time.sleep(4)
    raise PublishError(f"컨테이너 {container_id} 처리 시간 초과")


def ig_publish_carousel(token, image_urls, caption):
    token = token.strip()
    IG = _ig_base(token)
    me = ig_me(token)
    uid = me["user_id"]
    if len(image_urls) == 1:
        c = _check(requests.post(f"{IG}/{uid}/media", data={
            "image_url": image_urls[0], "caption": caption, "access_token": token}, timeout=TIMEOUT))
        creation_id = c["id"]
    else:
        children = []
        for url in image_urls:
            c = _check(requests.post(f"{IG}/{uid}/media", data={
                "image_url": url, "is_carousel_item": "true", "access_token": token}, timeout=TIMEOUT))
            children.append(c["id"])
        for cid in children:
            _ig_wait(cid, token)
        c = _check(requests.post(f"{IG}/{uid}/media", data={
            "media_type": "CAROUSEL", "children": ",".join(children),
            "caption": caption, "access_token": token}, timeout=TIMEOUT))
        creation_id = c["id"]
    _ig_wait(creation_id, token)
    return _ig_publish(IG, uid, creation_id, token)


def ig_publish_reel(token, video_path, caption, cover_url=None):
    """릴스: 영상 파일을 메타 서버로 직접 올린다(resumable 업로드). 피드에도 같이 보이게 share_to_feed.
    cover_url 이 있으면 그 이미지(공개 JPEG 주소)를 릴스 커버로 쓴다."""
    token = token.strip()
    IG = _ig_base(token)
    uid = ig_me(token)["user_id"]
    data = {"media_type": "REELS", "upload_type": "resumable", "caption": caption,
            "share_to_feed": "true", "access_token": token}
    if cover_url:
        data["cover_url"] = cover_url
    c = _check(requests.post(f"{IG}/{uid}/media", data=data, timeout=TIMEOUT))
    size = os.path.getsize(video_path)
    with open(video_path, "rb") as f:
        r = requests.post(c["uri"], data=f, timeout=600, headers={
            "Authorization": f"OAuth {token}", "offset": "0", "file_size": str(size)})
    if r.status_code >= 400:
        raise PublishError(f"릴스 영상 전송 실패 HTTP {r.status_code}: {r.text[:300]}")
    _ig_wait(c["id"], token, tries=90)   # 영상은 처리 시간이 길다 (최대 약 6분)
    return _ig_publish(IG, uid, c["id"], token)


def _ig_publish(IG, uid, creation_id, token):
    p = _check(requests.post(f"{IG}/{uid}/media_publish", data={
        "creation_id": creation_id, "access_token": token}, timeout=TIMEOUT))
    media_id = p["id"]
    link = _check(requests.get(f"{IG}/{media_id}", params={
        "fields": "permalink", "access_token": token}, timeout=TIMEOUT)).get("permalink")
    return {"media_id": media_id, "permalink": link}


def ig_refresh(token):
    token = token.strip()
    if token.startswith("EAA"):
        raise PublishError("페이스북 로그인 방식 토큰은 이 방법으로 연장하지 않아요 (만료 없는 토큰이면 연장 불필요)")
    return _check(requests.get("https://graph.instagram.com/refresh_access_token", params={
        "grant_type": "ig_refresh_token", "access_token": token}, timeout=TIMEOUT))


# ───────────────────────── Threads ─────────────────────────
def th_me(token):
    token = token.strip()
    return _check(requests.get(f"{TH_API}/me", params={
        "fields": "id,username", "access_token": token}, timeout=TIMEOUT))


def _th_create_and_publish(token, params):
    c = _check(requests.post(f"{TH_API}/me/threads", data={**params, "access_token": token}, timeout=TIMEOUT))
    # 미디어가 있으면 처리 시간을 조금 기다리는 게 공식 권장 사항
    time.sleep(30 if params.get("media_type") != "TEXT" else 3)
    p = _check(requests.post(f"{TH_API}/me/threads_publish", data={
        "creation_id": c["id"], "access_token": token}, timeout=TIMEOUT))
    return p["id"]


def th_publish(token, posts, image_url=None):
    """posts: 글 목록. 2개 이상이면 첫 글에 답글로 이어 붙여 연결 스레드로 올림."""
    token = token.strip()
    first = {"media_type": "IMAGE", "image_url": image_url, "text": posts[0]} if image_url \
        else {"media_type": "TEXT", "text": posts[0]}
    root_id = _th_create_and_publish(token, first)
    prev = root_id
    for text in posts[1:]:
        prev = _th_create_and_publish(token, {"media_type": "TEXT", "text": text, "reply_to_id": prev})
    link = _check(requests.get(f"{TH_API}/{root_id}", params={
        "fields": "permalink", "access_token": token}, timeout=TIMEOUT)).get("permalink")
    return {"thread_id": root_id, "permalink": link}


def th_refresh(token):
    token = token.strip()
    return _check(requests.get("https://graph.threads.net/refresh_access_token", params={
        "grant_type": "th_refresh_token", "access_token": token}, timeout=TIMEOUT))
