# 다음 작업 (Claude Code 에서 진행)

시작 방법: Claude Code 에서 이 저장소를 열고
> "CLAUDE.md 랑 docs/next-projects.md 읽고 ① 업로드 툴부터 같이 설계하자"

두 작업 모두 **먼저 사용자에게 설계안(화면 구성, 필요한 권한, 비용)을 보여주고 승인받은 뒤** 만든다.

---

## ① 맨티스 업로드 툴 (친구와 공유하는 웹 화면)

### 왜
지금은 `queue/` 에 날짜 붙인 폴더를 직접 만들고 post.json 을 손으로 써야 해서 번거롭고, 친구와 같이 쓰기 어렵다.

### 하고 싶은 것
- 카드 이미지 드래그&드롭 (순서 바꾸기, 표지 지정, 4:5 아닌 카드 경고)
- 캡션 / 쓰레드 글 / 유튜브 제목 / 샤오홍슈 중국어 제목·본문·태그 입력 칸
- (선택) 중국어 카드 따로 업로드 (zh/)
- 발행 날짜를 **달력에서 선택** → 내부적으로 `queue/YYYY-MM-DD_이름/` 으로 커밋
- 예약 목록(캘린더/리스트), 수정·삭제·순서 변경
- 발행 결과 보기: published/*/result.json 의 플랫폼별 성공/실패/링크
- "지금 발행", "토큰 상태 확인(check)" 버튼 → workflow_dispatch
- 친구와 공유 가능 (링크 + 로그인)

### 구현 후보 (사용자와 결정)
| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. GitHub Pages 정적 웹앱 + GitHub API | 저장소 Pages 로 호스팅, 각자 GitHub 로그인(또는 fine-grained PAT)으로 커밋 | 무료, 서버 없음, 지금 구조 그대로 | 친구도 GitHub 계정 필요, 토큰 관리 |
| B. Claude 아티팩트 페이지 | claude.ai 에서 공유 링크 | 만들기 빠름 | 이미지를 GitHub 로 보내는 경로가 까다로움 |
| C. Streamlit/로컬 앱 | PC에서 실행 | 단순 | 공유 어려움 |
- 추천 출발점: **A** (무료, 친구는 저장소 collaborator 로 초대).
- 비밀값은 절대 프런트엔드 코드에 넣지 않는다.

---

## ② 맨티스 전략비서 에이전트

### 하고 싶은 것 (사용자 원문 요약)
- **일간:** 어제 업로드가 플랫폼별로 잘 올라갔는지 (result.json, 어사이드 보고)
- **반응:** 그 전날 게시물의 조회수·좋아요·댓글·공유·저장·팔로워 증감
- **주간·월간 리포트:** 같은 지표 추이
- 반응 좋은 플랫폼 / 없는 플랫폼 구분, **이유 분석, 보완점**
- 결론: **인스타 유입을 늘리기 위해 최적화·보완할 부분** 제안 (주제, 훅, 표지, 업로드 시간, 캡션, CTA 등)

### 구조 제안
1. **수집(프로그램, 무료):** GitHub Actions `metrics.yml` 매일 1회 → `metrics/YYYY-MM-DD.json` 저장
   | 플랫폼 | 방법 | 필요 작업 |
   |---|---|---|
   | 인스타 | Graph API insights (reach, likes, comments, shares, saved, follows, profile_visits) | 토큰에 `instagram_manage_insights` 권한 있는지 확인, 없으면 재발급 |
   | 쓰레드 | Threads Insights API (views, likes, replies, reposts, quotes) | `threads_manage_insights` 권한 확인/추가 |
   | 유튜브 | Data API(조회수/좋아요/댓글) + YouTube Analytics API(시청 지속, 구독 증감) | `yt-analytics.readonly` 스코프 추가 → refresh token 재발급 |
   | 틱톡 | Display API `video.list` (view/like/comment/share) | 샌드박스에 `video.list` 스코프 추가 후 재인증 |
   | 네이버 클립, 샤오홍슈 | API 없음 → 어사이드 루틴이 크리에이터 화면 숫자를 읽어 GitHub 이슈/파일로 남기기 | 정확도 낮음 |
2. **분석·보고(에이전트):** Claude 예약 작업(scheduled task)으로
   - 매일 아침: 어제 업로드 상태 + 전날 반응 요약 (짧게, 폰 알림)
   - 매주 월: 주간 리포트 / 매월 1일: 월간 리포트
   - 리포트는 docs 또는 아티팩트 대시보드로, 원자료는 metrics/*.json
3. 리포트 기준: 숫자 비교(전주/전월 대비), 상위·하위 게시물, 플랫폼별 인스타 유입 기여 추정(인스타 profile_visits·follows 와 날짜 매칭), 실행 가능한 제안 3개 이내.

### 주의
- 권한 추가는 각 플랫폼에서 사용자가 직접 재인증해야 함.
- 리포트에 확인 안 된 숫자를 지어내지 말 것. 수집 실패한 플랫폼은 "데이터 없음"으로 표시.
