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
KST = dt.timezone(dt.timedelta(hours=9))
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")
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
    post.setdefault("platforms", ["instagram", "threads", "youtube"])
    return post


def card_images(folder):
    imgs = [p for p in folder.iterdir() if p.suffix.lower() in IMG_EXT and not p.name.startswith(".")
            and p.parent.name != "_jpg"]
    imgs.sort(key=lambda p: (0 if "cover" in p.name.lower() else 1, natural_key(p)))
    return imgs[:10]


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


def cmd_preview():
    items = due_items()
    if not items:
        log("발행할 게시물이 없어요 (queue 비어 있음 또는 날짜 전)"); return 0
    f = items[0]; post = load_post(f)
    log(f"다음 발행: {f.name}")
    log(f"  카드 {len(card_images(f))}장 / 플랫폼 {post['platforms']}")
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

    jpgs = ensure_jpegs(folder)
    if commit_push(f"prepare: {folder.name} 이미지 변환"):
        log("이미지 업로드 대기 20초"); time.sleep(20)
    urls = [raw_url(p) for p in jpgs]

    failed = False
    if "instagram" in post["platforms"] and not result.get("instagram", {}).get("ok"):
        try:
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

    if "youtube" in post["platforms"] and not result.get("youtube", {}).get("ok"):
        if not has_youtube():
            log("- 유튜브: 아직 연결 안 돼서 건너뜀")
        else:
            try:
                import shorts
                import youtube as Y
                video = Path("/tmp") / f"{folder.name}.mp4"
                info = shorts.build_short(card_images(folder), video)
                log(f"쇼츠 영상 생성: {info['seconds']}초, 음악 {info['music'] or '없음'}")
                title, desc, tags = youtube_meta(post)
                r = Y.yt_upload(video, title, desc, tags)
                result["youtube"] = {"ok": True, **r, "music": info["music"]}
                log(f"✓ 유튜브 업로드: {r['url']} ({r.get('privacy')})")
            except Exception as e:  # noqa: BLE001
                result["youtube"] = {"ok": False, "error": str(e)[:500]}; failed = True
                log(f"✗ 유튜브 실패: {e}")

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
