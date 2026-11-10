# 맨티스(Mentis) 프로젝트 — Claude Code용 안내

이 파일은 Claude Code가 이 저장소를 열었을 때 가장 먼저 읽는 프로젝트 메모다.
다음 할 일: **[docs/next-projects.md](docs/next-projects.md)** (① 업로드 툴: 코드 완성, 설정 대기 → [docs/uploader-setup.md](docs/uploader-setup.md) ② 전략비서 에이전트)

## 회의록 (작업 전에 확인)
- **[docs/meetings/](docs/meetings/README.md)** 에 성현·친구 회의록이 쌓인다. 맨티스 작업을 시작할 때 `docs/meetings/결정사항.md`(로컬 전용)와 최근 회의록을 먼저 읽는다.
- 회의 결정이 이 파일이나 다른 문서와 다르면 회의 결정이 우선. 어긋나는 문서는 사용자에게 알리고 고친다.
- 사용자가 회의 녹음(m4a 등)이나 텍스트를 주면 묻지 말고 알아서:
  1. 녹음이면 이 PC의 faster-whisper(large-v3-turbo, 캐시됨)로 받아쓰기 — 잡음 구간은 VAD로 제외. 원문은 `docs/meetings/raw/`
  2. 양식대로 정리해 **노션 '맨티스 > 맨티스 회의록' 데이터베이스**(data source `collection://f9ed62c7-0061-48cb-8795-a6eda647c6e4`)에 새 페이지로 올림. 속성: 회의(제목)·날짜·주제·한 줄 요약·녹음 길이(분)
  3. 로컬에도 `docs/meetings/YYYY-MM-DD_주제.md` 사본 + `결정사항.md` 갱신
  4. 영향 받는 문서·작업을 알려주고, 반영은 사용자 확인 후

## 누구 / 무엇
- 사용자: 조성현(GitHub 계정 bethementis 운영). 친구와 둘이 남성 자기관리 매거진 채널 '맨티스'를 운영. 레퍼런스: 세르칸(@iamtheserkan).
- 목표: **인스타그램 메인 채널(@bethementis) 유입 극대화.** 다른 플랫폼은 인스타 유입 통로 겸 별도 성장.
- 비용 원칙: **무료 스택 우선** (GitHub Actions, 공식 API, 무료 음원).
- 사용자는 비개발자. 설명은 한국어로, 쉽게. 전문용어는 풀어서.

## 사용자 규칙 (반드시 지킬 것)
- 토큰·비밀번호·시크릿 값은 채팅에 붙여넣게 하지 말 것. 사용자가 GitHub Secrets 에 직접 넣는다. 로그에도 출력 금지.
- 로그인·비밀번호 입력·OAuth 허용·영구 삭제는 사용자가 직접 한다.
- 실제 게시(공개 업로드) 테스트는 사용자 확인 후. 테스트는 가능하면 비공개/나만 보기/임시저장.

## 계정·채널
| 플랫폼 | 계정 | 연결 방식 |
|---|---|---|
| 인스타그램 | @bethementis (IG user id 17841423316407295) | Graph API, 페이스북 로그인형 EAA 토큰(만료 없음) `IG_ACCESS_TOKEN` |
| 쓰레드 | @bethementis | Threads API, 60일 토큰 `THREADS_ACCESS_TOKEN` (매주 자동 연장, `GH_PAT` 필요) |
| 유튜브 | "Mentis" 채널 (sunghyun2964@gmail.com 의 브랜드 채널. 같은 계정의 '맛도리 아이템' 채널과 혼동 주의) | YouTube Data API v3, `YT_CLIENT_ID/SECRET/REFRESH_TOKEN` (GCP 프로젝트 lofty-feat-513307-s3, OAuth 앱 Production 게시됨, 스코프 youtube.upload + youtube.readonly) |
| 틱톡 | mentis_02 ("Mentis 맨티스") | Content Posting API **샌드박스**(심사 안 받음), 스코프 user.info.basic + video.upload, **임시저장함(inbox) 업로드** → 사용자가 앱에서 트렌드 음악·캡션 넣고 게시. `TT_CLIENT_KEY/SECRET/REFRESH_TOKEN` (refresh token 자동 회전 저장). client_key 는 sbaw5jw5z13g1r1kox, redirect_uri 는 이 저장소 URL |
| 네이버 클립 | 채널 MENTIS (@bethementis), 블로그 blog.naver.com/bethementis | API 없음 → **어사이드(Aside) 루틴**, 클립 크리에이터 PC 웹 clipcreators.naver.com/web 에서 업로드 (블로그 PC/clip.naver.com 에선 새 클립 불가) |
| 샤오홍슈(rednote) | User6AE6A4F3 (이름 변경 예정, 현재 프로필 잠김) | API 없음 → **어사이드 루틴**, creator.rednote.com 이미지 노트(上传图文). 중국어 카드+중국어 본문 필수. 인스타 아이디/링크 언급 금지(限流) |

## 구조
```
publisher/
  publish.py        # check | preview | publish. queue/ 에서 그날 날짜 게시물 전부 발행 (3분 간격, 날짜 없는 건 하루 1개)
  platforms.py      # 인스타(캐러셀)·쓰레드 API
  youtube.py        # 쇼츠 업로드
  tiktok.py         # 틱톡 inbox 업로드 (무음 영상)
  tiktok_auth.py    # 최초 1회 code→refresh token 교환 (workflow: tiktok-auth.yml)
  shorts.py         # 카드 → 9:16 쇼츠 (1080x1920, 카드 1080x1350 at y=215, 표지 2.5s/카드 3.5s/엔딩 1.5s, 배경음 랜덤)
  refresh_tokens.py # 쓰레드(+IG_INSIGHTS_TOKEN 이 IGAA면) 토큰 주간 연장
  metrics.py        # 전략비서 숫자 수집 collect / 권한 점검 probe
  checks.py         # 전략비서 저녁 점검 (문제 있을 때만 알림 재료)
  reelmaker.py      # 릴스 만들기: subs(Whisper+DeepL→subs.json) / render(9:16·로고·자막·크레딧→reel.mp4) / preview(완성 화면 jpg) → docs/reel-studio.md
.github/workflows/
  publish.yml        # 매일 UTC 10:00 (~19:00 KST) + 0~25분 랜덤 지연. 수동: check/preview/publish
  refresh-tokens.yml # 매주 월
  tiktok-auth.yml    # 최초 연결용 (scope 추가 시 재인증에도 사용)
  metrics.yml        # 06:00 collect, 21:20 check (KST)
  reel-studio.yml    # 업로드 툴 '릴스 만들기'가 실행 (job, step=subs|render). DEEPL_API_KEY
  reel-auto.yml      # 세딸 자동 제작: Claude 예약 작업이 studio/*/auto.json 을 push 하면 완성본 렌더 → docs/reel-auto-routine.md
queue/               # 발행 대기. 폴더 1개 = 게시물 1개. 이름 앞 YYYY-MM-DD 면 그날 발행
published/           # 발행 완료 + result.json (플랫폼별 링크/ID)
outbox/              # 어사이드가 가져가는 파일 (naver/short.mp4, xhs/중국어 카드) + index.json, 14일 후 삭제
assets/music/        # 배경음 5곡 (60초, 음량 정규화). 유튜브·네이버 클립용
docs/aside-routines.md  # 어사이드 루틴 프롬프트
uploader/               # 업로드 툴 웹페이지 (GitHub Pages, 빌드 없음, GitHub API로 queue/ 에 커밋)
worker/                 # 업로드 툴 로그인 중계 (Cloudflare Worker, GitHub App OAuth code→토큰 교환만)
docs/uploader-setup.md  # 업로드 툴 최초 설정 순서 (사용자가 직접)
templates/post.json     # 게시물 설정 양식
templates/reel-styles.json  # 릴스 만들기 스타일 3개 (해외 소스·세르칸 / B 포맷 / C 촬영용) 위치·크기·색
studio/                 # 릴스 만들기 작업 폴더 (원본·자막·완성본). 예약하면 queue/ 로 옮기고 지움
```

### 게시물 폴더 형식
```
queue/2026-11-05_주제/
  00_cover.png, 01.png ...   # 한국어 카드 1080x1350(4:5), cover 가 맨 앞, 최대 20장 (인스타 API 캐러셀 한도. 17장 이상이면 쇼츠 60초 초과)
  zh/00_cover.png ...        # (선택) 샤오홍슈용 중국어 카드. 폰트 Noto Sans SC 등
  post.json                  # caption, threads[], threads_with_cover, youtube.title, naver.title, xhs{title(20자), body, tags}
```
- **릴스 게시물**: 카드 대신 `reel.mp4`(9:16, 95MB 이하) + post.json `"type": "reel"`. 인스타 릴스(resumable 업로드, share_to_feed) + 유튜브 쇼츠·틱톡·네이버 클립·샤오홍슈 영상 노트에 같은 영상(소리 그대로). 쓰레드 제외. xhs 는 zh 카드 없이 제목·본문만 있으면 됨 (outbox xhs/video.mp4, upload.json type=video).
- 플랫폼 기본값: instagram, threads, youtube, tiktok, naver, xhs. 실패한 플랫폼만 다음 날 재시도(result.json).
- 4:5 가 아닌 카드는 경고(카드 5 AHA/BHA 처럼 잘림 방지).

### 어사이드 루틴 (사용자 PC의 Aside 앱, 매일)
- 20:30 "맨티스 샤오홍슈 업로드", 20:40 "맨티스 네이버 클립 업로드"
- outbox/index.json 에서 오늘/어제 항목, TEST 폴더 제외, 같은 제목 있으면 건너뜀, 로그인/인증 화면이면 멈추고 보고.

## 운영 메모 / 알려진 것
- 개발 환경 프록시 때문에 gh GraphQL·secrets·로그 API 가 막힐 수 있었음 → REST dispatch 로 실행, 로그는 브라우저로 확인.
- 유튜브 업로드 채널 확인: `publish.py check` 로그에 "✓ 유튜브: Mentis 채널 연결됨".
- 틱톡 inbox 업로드는 캡션을 못 보냄 → 사용자가 앱에서 입력 (틱톡용 캡션 자동 준비는 미구현).
- 인스타 캐러셀은 API로 음악 불가.
- 캡션·쓰레드 글은 사용자가 Claude 앱 프로젝트(지시문: docs/caption-project.md)에서 만들어 업로드 툴에 붙여넣음 (Claude API 자동 생성은 비용 때문에 안 쓰기로 함, 2026-11-02).
- 피드(카드) 자동 생성기는 아직 없음. 카드는 사용자가 디자인 툴에서 만들어 넣는 중.
