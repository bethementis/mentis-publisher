# 맨티스 업로드 툴 — 처음 한 번 설정하기

툴 주소: **https://bethementis.github.io/mentis-publisher/**
코드: `uploader/` (웹페이지), `worker/` (로그인 중계). 비용 0원.

로그인·비밀값 입력은 전부 성현님이 직접 합니다. 비밀값(Client secret, API 토큰)은 채팅에 붙여넣지 마세요.
**Client ID 와 workers.dev 서브도메인은 비밀이 아니라서** Claude 에게 알려줘도 됩니다.

---

## 1. GitHub Pages 켜기
저장소 → **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꾸기.

## 2. Cloudflare 준비 (무료)
1. https://dash.cloudflare.com 가입 → 왼쪽 **Workers & Pages** 한 번 들어가기
   (처음 들어가면 `무언가.workers.dev` 서브도메인을 정하라고 나옴 → 이 이름을 기억)
2. 오른쪽 위 계정 메뉴 → **Account ID** 복사
3. **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" 템플릿** → 만들기 → 토큰 복사
4. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret** 에 직접 입력
   - `CLOUDFLARE_API_TOKEN` = 3번 토큰
   - `CLOUDFLARE_ACCOUNT_ID` = 2번 Account ID

## 3. GitHub App 만들기 ("GitHub로 로그인" 버튼용)
GitHub 오른쪽 위 프로필 → **Settings → Developer settings → GitHub Apps → New GitHub App**
| 칸 | 넣을 값 |
|---|---|
| GitHub App name | `Mentis Uploader` (이미 있으면 뒤에 아무 글자) |
| Homepage URL | `https://bethementis.github.io/mentis-publisher/` |
| Callback URL | `https://mentis-uploader-auth.<2-1의 서브도메인>.workers.dev/callback` |
| Expire user authorization tokens | **체크 해제** (매번 다시 로그인 안 하게) |
| Webhook → Active | **체크 해제** |
| Repository permissions | **Contents: Read and write**, **Actions: Read and write** |
| Where can this GitHub App be installed? | Only on this account |

만들기 → 화면의
- **Client ID** → Claude 에게 알려주기 (비밀 아님)
- **Generate a new client secret** → 복사해서 메모장에 잠깐 보관 (5단계에서 Cloudflare 에 직접 넣음)

왼쪽 **Install App → bethementis → Install → Only select repositories → mentis-publisher**

## 4. Claude 에게 두 가지 알려주기
"Client ID 는 ○○, 서브도메인은 ○○" → Claude 가 `worker/wrangler.toml`, `uploader/config.js` 를 채우고 올림
→ GitHub Actions 가 웹페이지와 로그인 중계를 자동 배포.

## 5. Client secret 넣기
Cloudflare → **Workers & Pages → mentis-uploader-auth → Settings → Variables and Secrets → Add**
- Type: **Secret**, 이름: `GITHUB_CLIENT_SECRET`, 값: 3단계 client secret → Deploy

## 6. 확인
툴 주소 접속 → **GitHub로 로그인** → Authorize → 내 아이디가 오른쪽 위에 보이면 끝.

---

## 친구가 쓰려면
1. 친구가 GitHub 계정 만들기 (무료)
2. 성현님: 저장소 **Settings → Collaborators → Add people** 로 친구 초대
3. 친구: 초대 메일 수락 → 툴 주소 접속 → GitHub로 로그인 → Authorize
(설치할 프로그램 없음. 폰 브라우저에서도 됨)

## 참고
- 예약하면 `queue/날짜_주제/` 에 카드(00_cover, 01, 02…)와 post.json 이 커밋됨. 발행은 기존대로 매일 19시 무렵.
- 저장소가 공개라서 예약한 카드·캡션은 발행 전에도 저장소에서 누구나 볼 수 있음.
- 삭제해도 GitHub 기록(커밋)에는 남아서 되살릴 수 있음.
- 로그인 정보(토큰)는 각자 브라우저에만 저장됨. 공용 PC 에서는 다 쓰고 **로그아웃**.
