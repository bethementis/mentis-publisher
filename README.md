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

## 틱톡
연결 완료 (샌드박스, 맨티스 계정). 매일 쇼츠가 **음악 없이 틱톡 임시저장함**으로 가요. 앱 알림에서 트렌드 음악과 캡션을 넣고 게시하세요.

## 네이버 클립 · 샤오홍슈 (어사이드 루틴)
발행 때 `outbox/날짜_이름/` 에 업로드 파일이 자동 생성됨 (naver/short.mp4, xhs/중국어 카드). 14일 지나면 자동 삭제.
어사이드 루틴 프롬프트와 준비 방법: [docs/aside-routines.md](docs/aside-routines.md)

## 다음 작업
Claude Code 용 안내: [CLAUDE.md](CLAUDE.md), 다음 할 일: [docs/next-projects.md](docs/next-projects.md)
