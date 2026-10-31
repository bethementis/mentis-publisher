"""유튜브 쇼츠 업로드 (YouTube Data API v3).

필요한 비밀값: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
구글 심사(감사) 전에는 API로 올린 영상이 '비공개'로 고정될 수 있다. 그때는 스튜디오에서 공개로 바꾸면 된다.
"""
import os

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]


def _client():
    creds = Credentials(
        token=None,
        refresh_token=os.environ["YT_REFRESH_TOKEN"].strip(),
        client_id=os.environ["YT_CLIENT_ID"].strip(),
        client_secret=os.environ["YT_CLIENT_SECRET"].strip(),
        token_uri="https://oauth2.googleapis.com/token",
    )
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def yt_me():
    r = _client().channels().list(part="snippet", mine=True).execute()
    items = r.get("items", [])
    return {"username": items[0]["snippet"]["title"] if items else None}


def yt_upload(video_path, title, description, tags=None, privacy="public"):
    title = title.strip()
    if "#shorts" not in title.lower():
        title = f"{title} #Shorts"
    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:4900],
            "tags": (tags or [])[:30],
            "categoryId": "26",            # 노하우/스타일
            "defaultLanguage": "ko",
        },
        "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False},
    }
    req = _client().videos().insert(
        part="snippet,status", body=body,
        media_body=MediaFileUpload(str(video_path), mimetype="video/mp4", resumable=True))
    resp = None
    while resp is None:
        _, resp = req.next_chunk()
    vid = resp["id"]
    return {"video_id": vid, "url": f"https://youtube.com/shorts/{vid}",
            "privacy": resp.get("status", {}).get("privacyStatus")}
