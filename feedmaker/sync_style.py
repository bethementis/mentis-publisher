"""피드 메이커 팀 기본 스타일을 index.html 에 넣는다.

- feedmaker/style.json 이 팀 기본 스타일(원본)이다.
- 피드 메이커에서 받은 mentis-style.json 을 feedmaker/ 에 그대로 올려도 된다.
  그러면 그 파일로 style.json 을 바꾸고, 올린 파일은 지운다.
- 그다음 style.json 내용을 index.html 의 <script id="team-style"> 칸에 복사한다.

GitHub Actions(.github/workflows/feedmaker-style.yml)가 자동으로 실행한다.
직접 돌릴 때: python3 feedmaker/sync_style.py
"""
import json
import pathlib
import re
import subprocess
import sys

DIR = pathlib.Path(__file__).resolve().parent
STYLE = DIR / "style.json"
INDEX = DIR / "index.html"
# 브라우저에서만 쓰는 값이라 팀 스타일에는 저장하지 않는다
RUNTIME_KEYS = ("savedAt", "isExample", "team")
BLOCK = re.compile(r'(<script type="application/json" id="team-style">)(.*?)(</script>)', re.S)


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def load(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        fail(f"{path.name} 을 읽지 못했어요. 피드 메이커의 '스타일 파일로 저장'으로 받은 파일인지 확인해 주세요. ({e})")
    if not isinstance(data, dict) or not any(k in data for k in ("colors", "fonts", "cover", "voice")):
        fail(f"{path.name} 은 피드 메이커 스타일 파일이 아니에요.")
    for k in RUNTIME_KEYS:
        data.pop(k, None)
    return data


def commit_time(path):
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%ct", "--", str(path)],
                             cwd=DIR, capture_output=True, text=True, check=False).stdout.strip()
        return int(out or 0)
    except Exception:  # noqa: BLE001
        return 0


def main():
    uploads = sorted(DIR.glob("mentis-style*.json"))
    if uploads:
        newest = max(uploads, key=lambda p: (commit_time(p), p.stat().st_mtime))
        data = load(newest)
        STYLE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for p in uploads:
            p.unlink()
        print(f"{newest.name} → style.json 으로 바꿨어요.")
    if not STYLE.exists():
        fail("feedmaker/style.json 이 없어요.")
    data = load(STYLE)
    # </script> 같은 글자가 HTML 을 끊지 않게 "</" 를 "<\/" 로 바꾼다 (JSON 에서 같은 뜻)
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = INDEX.read_text(encoding="utf-8")
    if not BLOCK.search(html):
        fail('index.html 에서 <script id="team-style"> 칸을 찾지 못했어요.')
    new = BLOCK.sub(lambda m: m.group(1) + blob + m.group(3), html, count=1)
    if new != html:
        INDEX.write_text(new, encoding="utf-8")
        print("index.html 의 팀 기본 스타일을 새로 넣었어요.")
    else:
        print("바뀐 것이 없어요.")


if __name__ == "__main__":
    main()
