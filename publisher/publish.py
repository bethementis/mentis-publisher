"""
맨티스 자동 발행기

queue/ 안의 폴더 하나 = 게시물 하나.
폴더 이름이 날짜로 시작하면(예: 2026-11-03_얼굴각질) 그 날짜가 되었을 때 발행한다.
날짜가 없으면 이름 순서대로 발행한다. 한 번 실행에 1개만 발행한다.

사용법:
  python publisher/publish.py check      # 토큰 확인만 (아무것도 안 올림)
  python publisher/publish.py preview    # 다음에 올라갈 게시물만 보여줌
  python publisher/publish.py publish    # 실제 발행
"""
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import platforms as P  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
QUEUE = ROOT / "queue"
DONE = ROOT / "published"
OUTBOX = ROOT / "outbox"   # 어사이드가 가져가서 올리는 파일 (네이버 클립, 샤오홍슈)
KST = dt.timezone(dt.timedelta(hours=9))
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")
REEL = "reel.mp4"          # 이 파일이 있으면 릴스 게시물 (인스타 릴스 + 유튜브·틱톡·네이버·샤오홍슈 영상, 쓰레드 제외)
REPO = os.environ.get("GITHUB_REPOSITORY", "bethementis/mentis-publisher")
BRANCH = os.environ.get("GITHUB_REF_NAME", "main")


def log(*a):
    print(*a, flush=True)


def git(*args):
    subprocess.run(["git", *args], cwd=ROOT, check=True)


def commit_push(msg):
    git("add", "-A")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 0:
        return False
    git("-c", "user.name=mentis-bot", "-c", "user.email=bot@users.noreply.github.com", "commit", "-m", msg)
    git("push", "origin", f"HEAD:{BRANCH}")
    return True


def natural_key(p):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.name)]


def due_items():
    if not QUEUE.exists():
        return []
    today = dt.datetime.now(KST).date()
    items = []
    for d in sorted([p for p in QUEUE.iterdir() if p.is_dir()], key=natural_key):
        m = re.match(r"(\d{4}-\d{2}-\d{2})", d.name)
        if m and dt.date.fromisoformat(m.group(1)) > today:
            continue
        items.append(d)
    return items


def load_post(folder):
    f = folder / "post.json"
    if not f.exists():
        raise SystemExit(f"{folder.name}: post.json 이 없어요")
    post = json.loads(f.read_text(encoding="utf-8"))
    post.setdefault("platforms", ["instagram", "threads", "youtube", "tiktok", "naver", "xhs"])
    return post


def reel_video(folder):
    v = folder / REEL
    return v if v.exists() else None


def card_images(folder):
    imgs = [p for p in folder.iterdir() if p.suffix.lower() in IMG_EXT and not p.name.startswith(".")
            and p.parent.name != "_jpg"]
    imgs.sort(key=lambda p: (0 if "cover" in p.name.lower() else 1, natural_key(p)))
    return imgs[:20]   # 인스타 캐러셀 최대 20장


def size_warnings(folder):
    """인스타 피드 권장 비율(4:5, 1080x1350)과 다른 카드를 찾아 경고 문구로 돌려준다."""
    out = []
    for p in card_images(folder):
        with Image.open(p) as im:
            w, h = im.size
        if abs(w / h - 0.8) > 0.01:
            out.append(f"⚠ {p.name}: {w}x{h} (비율 {w/h:.2f}) → 4:5(1080x1350)가 아니라 인스타·쇼츠에서 잘리거나 여백이 생길 수 있어요")
        elif w < 1080:
            out.append(f"⚠ {p.name}: {w}x{h} → 해상도가 낮아요 (1080x1350 권장)")
    return out


def ensure_jpegs(folder):
    """인스타 API는 JPEG만 받기 때문에 _jpg 폴더에 변환본을 만든다."""
    out = folder / "_jpg"
    out.mkdir(exist_ok=True)
    made = []
    for i, src in enumerate(card_images(folder), 1):
        dst = out / f"{i:02d}.jpg"
        if not dst.exists():
            im = Image.open(src).convert("RGB")
            im.save(dst, "JPEG", quality=92)
        made.append(dst)
    return made


def raw_url(path):
    from urllib.parse import quote
    rel = quote(path.relative_to(ROOT).as_posix())
    return f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{rel}"


def threads_posts(post):
    t = post.get("threads")
    if not t:
        return None
    return t if isinstance(t, list) else [t]


def cmd_check():
    ok = True
    for name, env, fn in [("인스타그램", "IG_ACCESS_TOKEN", P.ig_me), ("쓰레드", "THREADS_ACCESS_TOKEN", P.th_me)]:
        tok = os.environ.get(env)
        if not tok:
            log(f"✗ {name}: {env} 비밀값이 없어요"); ok = False; continue
        try:
            me = fn(tok)
            log(f"✓ {name}: @{me.get('username')} 연결됨")
        except P.PublishError as e:
            kind = "페이스북 로그인형(EAA)" if tok.strip().startswith("EAA") else \
                   "인스타 로그인형(IG)" if tok.strip().startswith("IG") else "알 수 없는 형식"
            log(f"✗ {name}: {e} / 토큰 형식: {kind}, 길이 {len(tok.strip())}자"); ok = False
            continue
    if has_youtube():
        try:
            import youtube as Y
            log(f"✓ 유튜브: {Y.yt_me().get('username')} 채널 연결됨")
        except Exception as e:  # noqa: BLE001
            log(f"✗ 유튜브: {e}"); ok = False
    else:
        log("- 유튜브: 아직 연결 안 됨 (YT_ 비밀값 없음)")
    import tiktok as T
    if T.has_tiktok():
        try:
            log(f"✓ 틱톡: {T.tt_me().get('username')} 연결됨")
        except Exception as e:  # noqa: BLE001
            log(f"✗ 틱톡: {e}"); ok = False
    else:
        log("- 틱톡: 아직 연결 안 됨 (TT_ 비밀값 없음)")
    return 0 if ok else 1


def has_youtube():
    return all(os.environ.get(k) for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"))


def youtube_meta(post):
    yt = post.get("youtube") or {}
    caption = post.get("caption", "")
    first = next((ln.strip() for ln in caption.splitlines() if ln.strip()), "맨티스")
    title = yt.get("title") or first
    body = yt.get("description") or re.sub(r"\n{3,}", "\n\n", caption)
    body += "\n\n더 많은 남자 자기관리 루틴은 인스타 @bethementis"
    tags = yt.get("tags") or [t.lstrip("#") for t in re.findall(r"#\S+", caption)]
    return title, body, tags


def zh_cards(folder):
    z = folder / "zh"
    if not z.is_dir():
        return []
    imgs = [p for p in z.iterdir() if p.suffix.lower() in IMG_EXT and not p.name.startswith(".")]
    imgs.sort(key=lambda p: (0 if "cover" in p.name.lower() else 1, natural_key(p)))
    return imgs[:18]


def build_outbox(folder, post, get_video):
    """네이버 클립(영상)·샤오홍슈(중국어 카드) 업로드 파일을 outbox/날짜_이름/ 에 만들어 둔다.
    어사이드 루틴이 outbox/index.json 을 보고 가져가서 올린다."""
    today = dt.datetime.now(KST).strftime("%Y-%m-%d")
    name = folder.name if folder.name[:4].isdigit() else f"{today}_{folder.name}"
    out = OUTBOX / name
    out.mkdir(parents=True, exist_ok=True)
    made, skipped = [], []

    if "naver" in post["platforms"]:
        nv = post.get("naver") or {}
        title, body, tags = youtube_meta(post)
        d = out / "naver"; d.mkdir(exist_ok=True)
        shutil.copy(get_video()["path"], d / "short.mp4")
        (d / "upload.json").write_text(json.dumps({
            "title": (nv.get("title") or title)[:40],
            "body": nv.get("body") or body,
            "tags": (nv.get("tags") or tags)[:10],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        made.append("naver")

    reel = reel_video(folder)
    if "xhs" in post["platforms"] and reel:
        x = post.get("xhs") or {}
        if not x.get("title") or not x.get("body"):
            skipped.append("샤오홍슈: post.json 의 xhs 제목·본문이 없어서 건너뜀")
        else:
            d = out / "xhs"; d.mkdir(exist_ok=True)
            shutil.copy(reel, d / "video.mp4")
            tags = x.get("tags") or []
            body = x["body"].rstrip() + ("\n\n" + " ".join("#" + t.lstrip("#") for t in tags) if tags else "")
            (d / "upload.json").write_text(json.dumps({
                "type": "video", "title": x["title"][:20], "body": body[:1000],
            }, ensure_ascii=False, indent=2), encoding="utf-8")
            made.append("xhs")
    elif "xhs" in post["platforms"]:
        x = post.get("xhs") or {}
        cards = zh_cards(folder)
        if not cards or not x.get("title") or not x.get("body"):
            skipped.append("샤오홍슈: zh/ 중국어 카드나 post.json 의 xhs 제목·본문이 없어서 건너뜀")
        else:
            d = out / "xhs"; d.mkdir(exist_ok=True)
            for i, c in enumerate(cards, 1):
                Image.open(c).convert("RGB").save(d / f"{i:02d}.jpg", "JPEG", quality=92)
            tags = x.get("tags") or []
            body = x["body"].rstrip() + ("\n\n" + " ".join("#" + t.lstrip("#") for t in tags) if tags else "")
            (d / "upload.json").write_text(json.dumps({
                "type": "images", "title": x["title"][:20], "body": body[:1000], "images": len(cards),
            }, ensure_ascii=False, indent=2), encoding="utf-8")
            made.append("xhs")

    # 목록 갱신 + 14일 지난 항목 정리
    cutoff = (dt.datetime.now(KST) - dt.timedelta(days=14)).strftime("%Y-%m-%d")
    entries = []
    for d in sorted(OUTBOX.iterdir()):
        if not d.is_dir():
            continue
        if d.name[:10] < cutoff:
            shutil.rmtree(d); continue
        plats = [k for k in ("naver", "xhs") if (d / k / "upload.json").exists()]
        entries.append({"date": d.name[:10], "folder": d.name, "platforms": plats,
                        "base_url": f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/outbox/{d.name}/"})
    (OUTBOX / "index.json").write_text(json.dumps({"items": entries[::-1]}, ensure_ascii=False, indent=2),
                                       encoding="utf-8")
    return {"path": f"outbox/{name}", "platforms": made, "skipped": skipped}


def cmd_preview():
    items = due_items()
    if not items:
        log("발행할 게시물이 없어요 (queue 비어 있음 또는 날짜 전)"); return 0
    f = items[0]; post = load_post(f)
    log(f"다음 발행: {f.name}")
    kind = "릴스 영상" if reel_video(f) else f"카드 {len(card_images(f))}장"
    log(f"  {kind} / 플랫폼 {post['platforms']}")
    for w in size_warnings(f):
        log("  " + w)
    log(f"  인스타 캡션: {post.get('caption','')[:80]}…")
    th = threads_posts(post)
    log(f"  쓰레드: {len(th) if th else 0}개 글")
    log(f"  대기 중인 게시물 총 {len(items)}개")
    return 0


def cmd_publish():
    items = due_items()
    if not items:
        log("발행할 게시물이 없어요"); return 0
    folder = items[0]
    post = load_post(folder)
    result_f = folder / "result.json"
    result = json.loads(result_f.read_text()) if result_f.exists() else {}
    log(f"발행 시작: {folder.name}")
    for w in size_warnings(folder):
        log(w)
        print(f"::warning::{w}", flush=True)

    reel = reel_video(folder)
    if reel:
        post["platforms"] = [p for p in post["platforms"] if p != "threads"]   # 릴스는 쓰레드 제외
        urls = []
    else:
        jpgs = ensure_jpegs(folder)
        if commit_push(f"prepare: {folder.name} 이미지 변환"):
            log("이미지 업로드 대기 20초"); time.sleep(20)
        urls = [raw_url(p) for p in jpgs]

    failed = False
    if "instagram" in post["platforms"] and not result.get("instagram", {}).get("ok"):
        try:
            if reel:
                r = P.ig_publish_reel(os.environ["IG_ACCESS_TOKEN"], reel, post.get("caption", ""))
            else:
                r = P.ig_publish_carousel(os.environ["IG_ACCESS_TOKEN"], urls, post.get("caption", ""))
            result["instagram"] = {"ok": True, **r}
            log(f"✓ 인스타 발행: {r.get('permalink')}")
        except Exception as e:  # noqa: BLE001
            result["instagram"] = {"ok": False, "error": str(e)}; failed = True
            log(f"✗ 인스타 실패: {e}")

    th = threads_posts(post)
    if "threads" in post["platforms"] and th and not result.get("threads", {}).get("ok"):
        try:
            img = urls[0] if post.get("threads_with_cover") else None
            r = P.th_publish(os.environ["THREADS_ACCESS_TOKEN"], th, img)
            result["threads"] = {"ok": True, **r}
            log(f"✓ 쓰레드 발행: {r.get('permalink')}")
        except Exception as e:  # noqa: BLE001
            result["threads"] = {"ok": False, "error": str(e)}; failed = True
            log(f"✗ 쓰레드 실패: {e}")

    videos = {}

    def get_video(silent=False):
        if reel:   # 직접 만든 릴스 영상은 소리 포함 그대로 쓴다
            return {"path": reel, "music": None, "seconds": None}
        key = "silent" if silent else "music"
        if key not in videos:
            import shorts
            video = Path("/tmp") / f"{folder.name}{'_silent' if silent else ''}.mp4"
            info = shorts.build_short(card_images(folder), video, music=False if silent else None)
            log(f"쇼츠 영상 생성({'무음' if silent else '배경음악'}): {info['seconds']}초, 음악 {info['music'] or '없음'}")
            videos[key] = {**info, "path": video}
        return videos[key]

    if "youtube" in post["platforms"] and not result.get("youtube", {}).get("ok"):
        if not has_youtube():
            log("- 유튜브: 아직 연결 안 돼서 건너뜀")
        else:
            try:
                import youtube as Y
                v = get_video()
                title, desc, tags = youtube_meta(post)
                r = Y.yt_upload(v["path"], title, desc, tags)
                result["youtube"] = {"ok": True, **r, "music": v["music"]}
                log(f"✓ 유튜브 업로드: {r['url']} ({r.get('privacy')})")
            except Exception as e:  # noqa: BLE001
                result["youtube"] = {"ok": False, "error": str(e)[:500]}; failed = True
                log(f"✗ 유튜브 실패: {e}")

    if "tiktok" in post["platforms"] and not result.get("tiktok", {}).get("ok"):
        import tiktok as T
        if not T.has_tiktok():
            log("- 틱톡: 아직 연결 안 돼서 건너뜀")
        else:
            try:
                v = get_video(silent=True)
                r = T.tt_upload_draft(v["path"])
                result["tiktok"] = {"ok": True, **r, "mode": "inbox"}
                log("✓ 틱톡 임시저장함으로 전송 — 앱 알림에서 확인하고 게시하세요")
            except Exception as e:  # noqa: BLE001
                result["tiktok"] = {"ok": False, "error": str(e)[:500]}; failed = True
                log(f"✗ 틱톡 실패: {e}")

    if any(k in post["platforms"] for k in ("naver", "xhs")) and not result.get("outbox", {}).get("ok"):
        try:
            r = build_outbox(folder, post, get_video)
            result["outbox"] = {"ok": True, **r}
            log(f"✓ 어사이드용 파일 준비: {r['path']} ({', '.join(r['platforms']) or '없음'})")
            for msg in r.get("skipped", []):
                log(f"- {msg}")
        except Exception as e:  # noqa: BLE001
            result["outbox"] = {"ok": False, "error": str(e)[:500]}; failed = True
            log(f"✗ 어사이드용 파일 준비 실패: {e}")

    result["updated_at"] = dt.datetime.now(KST).isoformat(timespec="seconds")
    result_f.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if not failed:
        DONE.mkdir(exist_ok=True)
        stamp = dt.datetime.now(KST).strftime("%Y-%m-%d")
        dest = DONE / (folder.name if folder.name[:4].isdigit() else f"{stamp}_{folder.name}")
        shutil.move(str(folder), str(dest))
        commit_push(f"published: {folder.name}")
        log("완료. published/ 로 옮겼어요")
        return 0
    commit_push(f"partial: {folder.name} (실패한 플랫폼은 다음 실행 때 다시 시도)")
    return 1


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "preview"
    sys.exit({"check": cmd_check, "preview": cmd_preview, "publish": cmd_publish}[mode]())
