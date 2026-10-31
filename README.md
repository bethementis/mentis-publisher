# 맨티스 자동 발행기 (mentis-publisher)

완성된 피드를 `queue/`에 넣어두면 **매일 저녁 7시 무렵** 인스타 피드(캐러셀), 쓰레드, 유튜브 쇼츠에 자동으로 하나씩 올라갑니다.
쇼츠는 카드를 컷으로 붙인 9:16 영상으로 자동 변환되고, 마지막에 Mentis 로고와 @bethementis 카드가 붙어요. `assets/music/`에 mp3를 넣어두면 배경음악으로 깔려요.
노트북이 꺼져 있어도 GitHub 서버에서 돌아가요. 비용은 0원입니다.

## 게시물 넣는 법
1. `queue/` 안에 폴더를 하나 만듭니다. 이름 앞에 날짜를 붙이면 그 날짜에 올라가요.
   - 예: `queue/2026-11-03_얼굴각질/`
   - 날짜를 안 붙이면 이름 순서대로 하루에 하나씩 올라가요.
2. 폴더에 카드 이미지를 넣습니다 (png/jpg). 파일 이름 순서대로 올라가고, 이름에 `cover`가 들어간 파일이 맨 앞이에요. 최대 10장.
3. `templates/post.json`을 복사해서 같은 폴더에 넣고 캡션과 쓰레드 글을 고칩니다.

올라가면 폴더가 `published/`로 옮겨지고, `result.json`에 게시물 링크가 남아요.
한쪽만 실패하면 폴더가 `queue/`에 남고, 다음 날 실패한 쪽만 다시 시도해요.

## 직접 실행하기 (Actions 탭)
**Actions → 맨티스 자동 발행 → Run workflow**에서 모드를 고르세요.
- `check`: 토큰이 살아 있는지 확인 (아무것도 안 올림)
- `preview`: 다음에 올라갈 게시물 확인
- `publish`: 지금 바로 하나 발행

## 필요한 비밀값 (Settings → Secrets and variables → Actions)
| 이름 | 내용 |
|---|---|
| `IG_ACCESS_TOKEN` | 메타 앱에서 발급한 인스타 토큰 |
| `THREADS_ACCESS_TOKEN` | 메타 앱에서 발급한 쓰레드 토큰 |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | 구글 클라우드에서 발급한 유튜브 업로드용 값 |
| `GH_PAT` | (선택) 토큰 자동 연장용 GitHub 토큰 |

토큰은 60일마다 만료돼요. `GH_PAT`을 넣어두면 **토큰 연장 (매주)** 작업이 알아서 연장합니다.

## 앞으로 붙일 것
- 틱톡 (초안함으로 보내기)
- 네이버 클립, 샤오홍슈 (어사이드 루틴)

## 틱톡 연결 (남은 단계 — 맨티스 틱톡 계정 로그인 필요)
설정 완료: 개발자 앱 "Mentis Publisher" 샌드박스(mentis), video.upload 권한, TT_CLIENT_KEY / TT_CLIENT_SECRET 비밀값.
남은 것:
1. 틱톡 개발자 포털 → 샌드박스 mentis → 대상 사용자 → 계정 추가 → 맨티스 틱톡 계정 로그인
2. 아래 주소에서 맨티스 계정으로 로그인 → 허용
   https://www.tiktok.com/v2/auth/authorize/?client_key=sbaw5jw5z13g1r1kox&scope=user.info.basic,video.upload&response_type=code&redirect_uri=https%3A%2F%2Fgithub.com%2Fbethementis%2Fmentis-publisher&state=mentis
3. 돌아온 주소의 code 값으로 Actions → "틱톡 연결 (최초 1회)" 실행 → TT_REFRESH_TOKEN 자동 저장
연결 전에는 발행 시 틱톡만 자동으로 건너뜀.

## 네이버 클립 · 샤오홍슈 (어사이드 루틴)
발행 때 `outbox/날짜_이름/` 에 업로드 파일이 자동 생성됨 (naver/short.mp4, xhs/중국어 카드). 14일 지나면 자동 삭제.
어사이드 루틴 프롬프트와 준비 방법: [docs/aside-routines.md](docs/aside-routines.md)
