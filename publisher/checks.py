"""맨티스 전략비서 — 🚨 저녁 점검 (매일 21:20 KST, 발행·어사이드가 끝난 뒤).

문제가 있을 때만 알리기 위한 재료를 만든다 → metrics/checks/YYYY-MM-DD.json
Claude 예약 작업(21:30)이 이 파일을 읽고 "이상 없음" 또는 문제 목록을 보고한다.
  🚨 문제: 지금 손봐야 함 / ⚠ 주의: 알아두면 좋음
토큰 값은 절대 출력·저장하지 않는다.
"""
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
import platforms as P  # noqa: E402
import publish as PB  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "metrics" / "checks"
KST = PB.KST
REPO = os.environ.get("GITHUB_REPOSITORY", "bethementis/mentis-publisher")
RUNWAY_DAYS = 3        # 앞으로 3일 안에 빈 날이 생기면 알림
UPCOMING_DAYS = 7      # 7일 안에 올라갈 게시물을 미리 검사

problems = []
SETTINGS_FILE = ROOT / "metrics" / "settings.json"
SETTINGS = json.loads(SETTINGS_FILE.read_text(encoding="utf-8")) if SETTINGS_FILE.exists() else {}


def add(level, area, msg):
    problems.append({"level": level, "area": area, "msg": msg})
    print(f"{'🚨' if level == 'problem' else '⚠'} [{area}] {msg}", flush=True)


def folder_date(d):
    m = re.match(r"(\d{4}-\d{2}-\d{2})", d.name)
    return dt.date.fromisoformat(m.group(1)) if m else None


def check_runway(today):
    """앞으로 RUNWAY_DAYS일 동안 매일 올릴 게시물이 있는지. 날짜 없는 폴더는 빈 날을 순서대로 채운다."""
    if not SETTINGS.get("queue_runway_alert", True):
        return     # 준비 단계라 꺼둠 (metrics/settings.json)
    folders = [p for p in PB.QUEUE.iterdir() if p.is_dir()] if PB.QUEUE.exists() else []
    dated = {folder_date(p) for p in folders if folder_date(p)}
    spare = sum(1 for p in folders if not folder_date(p))
    # 이미 지난 날짜인데 아직 queue 에 있는 것도 다음 날 올라가니 여분으로 친다
    spare += sum(1 for p in folders if folder_date(p) and folder_date(p) <= today)
    for i in range(1, RUNWAY_DAYS + 1):
        day = today + dt.timedelta(days=i)
        if day in dated:
            continue
        if spare:
            spare -= 1
            continue
        add("problem", "예약", f"{i}일 뒤({day:%m/%d})부터 올릴 게시물이 없어요. 업로드 툴에서 예약해 주세요.")
        return


def check_today(today, yesterday_fails):
    """오늘 발행 결과(result.json). 같은 플랫폼이 어제도 실패했으면 2일 연속으로 표시."""
    fails, found = {}, False
    for base in (PB.DONE, PB.QUEUE):
        if not base.exists():
            continue
        for d in base.iterdir():
            f = d / "result.json"
            if not f.exists():
                continue
            r = json.loads(f.read_text(encoding="utf-8"))
            if not str(r.get("updated_at", "")).startswith(today.isoformat()):
                continue
            found = True
            for plat, v in r.items():
                if isinstance(v, dict) and v.get("ok") is False:
                    fails[plat] = {"post": d.name, "error": str(v.get("error"))[:200]}
    for plat, v in fails.items():
        again = " — 2일 연속 실패" if plat in yesterday_fails else ""
        add("problem", "발행", f"{plat} 실패{again} ({v['post']}): {v['error']}")
    if not found and any(folder_date(p) and folder_date(p) <= today
                         for p in (PB.QUEUE.iterdir() if PB.QUEUE.exists() else []) if p.is_dir()):
        add("problem", "발행", "오늘 올라갔어야 할 게시물이 있는데 발행 기록이 없어요 (자동 발행이 안 돌았을 수 있음).")
    return fails


def aside_reports(day):
    """어사이드가 GitHub 이슈에 남긴 보고(```json 블록) 중 그날 것. {platform: report}"""
    issue = SETTINGS.get("aside_issue")
    if not issue:
        return None
    r = requests.get(f"https://api.github.com/repos/{REPO}/issues/{issue}/comments",
                     params={"per_page": 50, "since": f"{day - dt.timedelta(days=2)}T00:00:00Z"}, timeout=30)
    out = {}
    for c in r.json() if r.ok else []:
        m = re.search(r"```json\s*(\{.*?\})\s*```", c.get("body", ""), re.S)
        try:
            rep = json.loads(m.group(1)) if m else None
        except ValueError:
            rep = None
        if rep and rep.get("date") == day.isoformat() and rep.get("aside"):
            out[rep["aside"]] = rep      # 같은 날 여러 번이면 마지막 보고
    return out


def check_aside(today):
    """오늘 outbox 에 네이버/샤오홍슈 파일이 준비됐는데 어사이드 보고가 없거나 실패면 알림."""
    reports = aside_reports(today)
    if reports is None:
        return     # 아직 보고 이슈 연결 전
    idx = PB.OUTBOX / "index.json"
    items = json.loads(idx.read_text(encoding="utf-8")).get("items", []) if idx.exists() else []
    need = {p for it in items if it.get("date") == today.isoformat() and "TEST" not in it.get("folder", "")
            for p in it.get("platforms", [])}
    names = {"naver": "네이버 클립", "xhs": "샤오홍슈"}
    for plat in sorted(need):
        rep = reports.get(plat)
        if not rep:
            add("problem", "어사이드", f"{names[plat]} 업로드 보고가 없어요 (루틴이 안 돌았거나 PC가 꺼져 있었을 수 있음).")
        elif rep.get("upload") == "fail":
            add("problem", "어사이드", f"{names[plat]} 업로드 실패: {rep.get('reason') or '이유 없음'}")


def check_tokens():
    tests = []
    if os.environ.get("IG_ACCESS_TOKEN"):
        tests.append(("인스타(발행용)", lambda: P.ig_me(os.environ["IG_ACCESS_TOKEN"])))
    if os.environ.get("IG_INSIGHTS_TOKEN"):
        tests.append(("인스타(숫자용)", lambda: P.ig_me(os.environ["IG_INSIGHTS_TOKEN"])))
    if os.environ.get("THREADS_ACCESS_TOKEN"):
        tests.append(("쓰레드", lambda: P.th_me(os.environ["THREADS_ACCESS_TOKEN"])))
    if PB.has_youtube():
        import youtube as Y
        tests.append(("유튜브", Y.yt_me))
    import tiktok as T
    if T.has_tiktok():
        tests.append(("틱톡", T.tt_me))
    for name, fn in tests:
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            add("problem", "토큰", f"{name} 연결 실패 — 만료됐을 수 있어요: {str(e)[:200]}")
    # 매주 토큰 연장 로봇이 마지막에 실패했는지
    try:
        runs = requests.get(f"https://api.github.com/repos/{REPO}/actions/workflows/refresh-tokens.yml/runs",
                            params={"per_page": 1}, timeout=30).json().get("workflow_runs", [])
        if runs and runs[0].get("conclusion") == "failure":
            add("problem", "토큰", f"매주 토큰 연장이 실패했어요 ({runs[0]['created_at'][:10]}). 쓰레드 토큰이 60일 뒤 만료될 수 있어요.")
    except Exception:  # noqa: BLE001
        pass


def check_upcoming(today):
    """7일 안에 올라갈 게시물 미리 검사."""
    if not PB.QUEUE.exists():
        return
    for d in sorted(p for p in PB.QUEUE.iterdir() if p.is_dir()):
        day = folder_date(d)
        if day and day > today + dt.timedelta(days=UPCOMING_DAYS):
            continue
        try:
            post = PB.load_post(d)
        except Exception as e:  # noqa: BLE001
            add("problem", "예약 게시물", f"{d.name}: post.json 을 읽을 수 없어요 ({e})")
            continue
        plats = post["platforms"]
        if not PB.card_images(d):
            add("problem", "예약 게시물", f"{d.name}: 카드 이미지가 없어요.")
            continue
        for w in PB.size_warnings(d):
            add("warn", "예약 게시물", f"{d.name}: {w.lstrip('⚠ ')}")
        if "instagram" in plats and not post.get("caption", "").strip():
            add("problem", "예약 게시물", f"{d.name}: 인스타 캡션이 비어 있어요.")
        if "threads" in plats and not PB.threads_posts(post):
            add("warn", "예약 게시물", f"{d.name}: 쓰레드 글이 비어 있어서 쓰레드는 건너뛰어요.")
        if "xhs" in plats:
            x = post.get("xhs") or {}
            if not PB.zh_cards(d) or not x.get("title") or not x.get("body"):
                add("warn", "예약 게시물", f"{d.name}: 샤오홍슈용 중국어 카드·제목·본문 중 빠진 게 있어서 샤오홍슈는 건너뛰어요.")
            elif len(x["title"]) > 20:
                add("warn", "예약 게시물", f"{d.name}: 샤오홍슈 제목이 20자를 넘어서 잘려요.")


def main():
    now = dt.datetime.now(KST)
    today = now.date()
    prev = OUT / f"{today - dt.timedelta(days=1)}.json"
    yesterday_fails = json.loads(prev.read_text(encoding="utf-8")).get("fails", {}) if prev.exists() else {}

    check_runway(today)
    fails = check_today(today, yesterday_fails)
    check_tokens()
    check_upcoming(today)
    check_aside(today)

    result = {"date": today.isoformat(), "checked_at": now.isoformat(timespec="seconds"),
              "status": "문제 있음" if any(p["level"] == "problem" for p in problems) else
                        ("주의" if problems else "이상 없음"),
              "problems": problems, "fails": fails}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{today}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"결과: {result['status']} → metrics/checks/{today}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
