"""인스타그램 / 쓰레드 공식 API 호출 모음."""
import time
import requests

IG_API = "https://graph.instagram.com/v23.0"
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
def ig_me(token):
    return _check(requests.get(f"{IG_API}/me", params={
        "fields": "user_id,username", "access_token": token}, timeout=TIMEOUT))


def _ig_wait(container_id, token, tries=30):
    for _ in range(tries):
        d = _check(requests.get(f"{IG_API}/{container_id}", params={
            "fields": "status_code,status", "access_token": token}, timeout=TIMEOUT))
        code = d.get("status_code")
        if code == "FINISHED":
            return
        if code in ("ERROR", "EXPIRED"):
            raise PublishError(f"컨테이너 {container_id} 실패: {d.get('status')}")
        time.sleep(4)
    raise PublishError(f"컨테이너 {container_id} 처리 시간 초과")


def ig_publish_carousel(token, image_urls, caption):
    me = ig_me(token)
    uid = me["user_id"]
    if len(image_urls) == 1:
        c = _check(requests.post(f"{IG_API}/{uid}/media", data={
            "image_url": image_urls[0], "caption": caption, "access_token": token}, timeout=TIMEOUT))
        creation_id = c["id"]
    else:
        children = []
        for url in image_urls:
            c = _check(requests.post(f"{IG_API}/{uid}/media", data={
                "image_url": url, "is_carousel_item": "true", "access_token": token}, timeout=TIMEOUT))
            children.append(c["id"])
        for cid in children:
            _ig_wait(cid, token)
        c = _check(requests.post(f"{IG_API}/{uid}/media", data={
            "media_type": "CAROUSEL", "children": ",".join(children),
            "caption": caption, "access_token": token}, timeout=TIMEOUT))
        creation_id = c["id"]
    _ig_wait(creation_id, token)
    p = _check(requests.post(f"{IG_API}/{uid}/media_publish", data={
        "creation_id": creation_id, "access_token": token}, timeout=TIMEOUT))
    media_id = p["id"]
    link = _check(requests.get(f"{IG_API}/{media_id}", params={
        "fields": "permalink", "access_token": token}, timeout=TIMEOUT)).get("permalink")
    return {"media_id": media_id, "permalink": link}


def ig_refresh(token):
    return _check(requests.get("https://graph.instagram.com/refresh_access_token", params={
        "grant_type": "ig_refresh_token", "access_token": token}, timeout=TIMEOUT))


# ───────────────────────── Threads ─────────────────────────
def th_me(token):
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
    return _check(requests.get("https://graph.threads.net/refresh_access_token", params={
        "grant_type": "th_refresh_token", "access_token": token}, timeout=TIMEOUT))
