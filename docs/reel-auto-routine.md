# 세딸 자동 제작 — Claude 예약 작업 지시문

이 파일이 예약 작업(매일 밤 11시, 한국 시간)의 할 일 전부다. 설계 배경은 `docs/reel-auto-design.md`.
저장소: bethementis/mentis-publisher, 브랜치 main. **게시(업로드)는 절대 하지 않는다** — 사람이 업로드 툴 '후보'에서 골라 예약한다.

## 0. 할 일 찾기
1. `git pull` 후 `studio/*/job.json` 중 아래를 모두 만족하는 작업을 찾는다 (한 번에 최대 10개, 오래된 것부터):
   - `"auto": true`
   - `status.json` 이 `{"step": "subs", "state": "done"}`
   - `auto.json` 이 아직 없음
2. 없으면 "할 일 없음" 한 줄만 남기고 끝낸다 (아무것도 커밋하지 않는다).
3. `job.json` 에 `credit.handle` 이나 `credit.permission` 이 비어 있으면 그 작업은 건너뛴다 (허락 확인이 안 된 영상).

## 1. 준비
```bash
pip install -q pillow requests imageio-ffmpeg
export FFMPEG=$(python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
```
읽을 것: `templates/reel-styles.json`(기본 스타일), `templates/reel-presets.json` 의 `overseas`(성현님이 저장한 기본값 — **이게 출발점**),
`docs/caption-project.md`(캡션 규칙 · 저장·공유 원칙 · 정체 숨기기).

## 2. 작업마다 만들기 (Claude 1 = 제작)
작업 폴더 `studio/<이름>/` 의 `job.json`, `subs.json`(segments: start·end·text(한국어)·src(영어 원문)) 을 읽는다.

**화면 보기**: `python publisher/reelmaker.py preview studio/<이름> /tmp/pv/<이름>` → 완성본과 똑같은 화면 jpg 몇 장(로고·위쪽 문구·자막 포함).
시간을 정하려면 끝에 `0.5,3.2,8` 처럼 초를 붙인다. 고칠 때마다 다시 뽑아서 눈으로 확인한다.

### 2-1. 자막 (subs.json `segments`)
- 번역을 자연스러운 한국어 말투로 다듬는다 (번역투 ✗, 짧고 담담하게). `src` 는 그대로 둔다.
- 자막은 **항상 한 줄**. 길면 (대략 18자 넘으면) 뜻이 끊기지 않는 곳에서 둘로 나누고 시간도 글자 수 비율로 나눈다.
- Whisper 가 지어낸 말("you", "Thank you." 같은 것)이나 소리 없는 구간 자막은 지운다.

### 2-2. 위치·색 (subs.json `styles`)
- 기본값(presets.overseas)을 그대로 쓰는 게 원칙. `styles` 에는 **바꿔야 하는 값만** 넣는다. 예: `{"subtitle": {"y": 1420}, "logo": {"color": "#FFFFFF"}}`
- **원본에 영어 자막이 박혀 있으면 가리지 않는다.** 한국어 자막을 영어 자막 **바로 밑**에 둔다
  (subtitle `y` = 영어 자막 아래 끝 + 자막 글자 크기의 절반 + 20 정도, 1080×1920 기준). 영어 자막이 화면 아래쪽이라 밑에 자리가 없으면 바로 위에.
  `auto.json` 의 `en_subs` 를 true 로.
- 글자끼리 겹치지 않게 (위쪽 문구 · 한국어 자막 · 영어 자막 · 로고). 겹치면 로고 `y` 를 옮긴다.
- 배경 때문에 글자·로고가 잘 안 보이면: 글자색·테두리 색을 바꾸거나 테두리(`stroke`)를 늘린다. 로고는 `color` 를 흰색 계열로 바꾸거나 `bold`(최대 4)를 올린다.
- **출처는 화면에 넣지 않는다**: `credit_on` 은 false (원작자 정보는 캡션에만).
- 코너 이름은 화면에 안 나온다 (썸네일에만).

### 2-3. 위쪽 문구(훅) 2개
- 영상 주제와 딱 맞는 말 (억지로 '대상 좁히기'를 끼우지 않는다). 짧게 (한 줄 18자 안팎, 필요하면 Enter 로 두 줄), 강조할 말 하나만 `*별표*`.
- 예: 거북목 교정 영상 → "거북목, *12초*면 펴져요". 첫 1초에 스크롤을 멈추게 하는 말.
- 둘은 말투나 각도가 달라야 한다 (예: 숫자·결과형 / 질문·찔림형).

### 2-4. 코너 (job.json `corner`, 썸네일에만 들어감)
`Hair Lab` · `Skin Note` · `Body` · `Style` · `Routine` 중 하나, 안 맞으면 빈칸.

### 2-5. 썸네일 (`thumb.json`)
```json
{ "design": "<presets.overseas.thumb.design>", "text": "거북목,\n*12초*면 펴져요", "t": 3.4, "opt": { ...presets.overseas.thumb.opt } }
```
- `t` = 썸네일 장면 (초). 선명하고, 무엇에 대한 영상인지 보이는 장면. preview 로 확인.
- `text` = 영상 주제와 맞는 짧은 멘트 (위쪽 문구와 같거나 비슷해도 된다).
- `opt` 은 기본값 그대로. 장면이 밝아서 글자가 안 보일 것 같으면 `opt.dim`(사진 어둡게, %)을 올리거나 `opt.text.color`/`opt.text.stroke` 를 바꾼다.

### 2-6. 캡션
`docs/caption-project.md` 의 '1. 인스타 캡션' 규칙대로. 맨 끝 줄은 반드시:
`🎥 영상: @원작자 (원작자 허락 받고 사용)` — 원작자 정보는 여기에만.

## 3. 채점 (Claude 2 = 채점자, 만든 쪽과 따로)
**Agent 도구로 새 서브에이전트를 띄워** 채점시킨다 (만든 과정·이유는 넘기지 않는다. 결과물과 채점표만).
서브에이전트를 쓸 수 없으면 만든 이유를 보지 말고 결과물만 다시 읽고 채점한다.
넘길 것: 훅 2개, 자막 전체, 썸네일 멘트, 캡션, preview jpg 경로(썸네일 장면 포함), 아래 채점표.

| 항목 | 점수 | 보는 것 |
|---|---|---|
| 조회 (터질까) `views` | 40 | 첫 1초 훅이 스크롤을 멈추게 하나 / 끝까지 보게 하나 (궁금증을 만들고 끝에 풀어주나, 길이) / 20~30대 남자 누구나 "내 얘기"인가 / 썸네일만 봐도 누르고 싶나 |
| 공유 (보낼까) `share` | 30 | "이거 너 얘기다" 찔림·공감 / 친구 놀리기 좋은 포인트 / 말 걸 거리 (의외의 사실) |
| 저장 (다시 볼까) `save` | 30 | 나중에 꺼내 볼 정보 (순서·주기·조합·제품) / 바로 따라 할 수 있나 |
| 감점 `minus` | − | 어색한 번역, 억지 문구, 자막 오류·겹침·안 보임, 맨티스 정체 노출 |

채점자는 훅마다 `{views, share, save, minus, total, reason, improve}` 를 돌려준다 (reason·improve 는 쉬운 한국어 한 줄씩).
**점수가 높은 훅**을 subs.json `hook` 에 넣는다. 짠 점수를 부풀리지 않는다 — 점수는 사람이 고르는 기준이다.

## 4. 저장
작업마다:
- `subs.json` (다듬은 자막, `hook`, `credit_on: false`, `styles`)
- `job.json` (`corner` 만 바꿈, 다른 값은 그대로)
- `thumb.json`
- `auto.json`:
```json
{ "made_at": "2026-11-10T15:00:00+09:00", "hook": "고른 훅", "hooks": [{"text": "...", "total": 78}, {"text": "...", "total": 71}],
  "score": {"views": 31, "share": 22, "save": 25, "minus": 0, "total": 78},
  "reason": "...", "improve": "...", "caption": "캡션 전체", "en_subs": true }
```
- `status.json` = `{"step": "render", "state": "queued", "at": "<지금, +09:00>"}`

전부 한 커밋으로: `git add studio/<이름들>` → `git commit -m "reel auto: 제작·채점 N개"` → `git push origin HEAD:main` (충돌이면 `git pull --rebase origin main` 후 다시).
main 에 push 가 막혀 있으면 지금 브랜치(`claude/…`)에 push 한다 — 워크플로가 그 브랜치의 studio/ 파일(subs·job·thumb·auto·status.json)만 main 으로 가져온다.
push 하면 `.github/workflows/reel-auto.yml` 이 완성본(reel.mp4)을 만들고, 업로드 툴 '후보'에 점수 순으로 뜬다.

## 하지 말 것
- 게시·예약 (queue/ 건드리지 않기), studio/ 밖의 파일 수정, 다른 작업 폴더 수정.
- 남의 영상 내려받기, 새 영상 추가.
- 비밀값·토큰 출력.
- raw 영상 수정·삭제.
