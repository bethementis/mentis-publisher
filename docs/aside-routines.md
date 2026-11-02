# 어사이드 업로드 루틴 (네이버 클립 · 샤오홍슈)

매일 저녁 GitHub 자동 발행이 끝나면(한국시간 19~20시) `outbox/` 에 업로드용 파일이 생긴다.
어사이드 루틴은 **매일 20:30** 에 돌리고, 아래 프롬프트를 그대로 붙여 넣는다.
처음 1~2번은 루틴 대신 직접 실행해서 화면을 지켜보고, 문제없으면 루틴으로 돌린다.

---

## 1. 네이버 클립 루틴 (클립 크리에이터 PC 웹)

- PC에서 클립을 새로 올릴 수 있는 곳은 **클립 크리에이터 PC 웹(clipcreators.naver.com/web)** 뿐 (2026-11 확인).
  블로그 PC 에디터·clip.naver.com 에서는 새 클립 생성 불가 (블로그 앱 전용).
- 맨티스 계정: 네이버 블로그 blog.naver.com/bethementis, 클립 채널 MENTIS (@bethementis)

### 루틴 프롬프트 (매일 20:40)
```
너는 맨티스 채널의 네이버 클립 업로드 담당이야. 클립은 반드시 클립 크리에이터 PC 웹에서 맨티스 채널(@bethementis)로 올려.
1. https://raw.githubusercontent.com/bethementis/mentis-publisher/main/outbox/index.json 을 열어.
2. items 중 date 가 오늘 또는 어제이고 platforms 에 "naver" 가 있는 항목만 골라. folder 이름에 TEST 가 들어간 항목은 제외해. 없으면 "오늘 올릴 네이버 클립 없음"이라고 보고하고 끝내.
3. 각 항목마다 {base_url}naver/upload.json 에서 title, body, tags 를 읽어.
4. https://clipcreators.naver.com/web 에 접속해서 로그인된 채널이 MENTIS(@bethementis)인지 확인해. 아니거나 로그인이 필요하면 올리지 말고 멈추고 보고해.
5. 콘텐츠 목록에 같은 제목(설명 첫 줄)의 영상이 이미 있으면 건너뛰어.
6. {base_url}naver/short.mp4 를 내려받아 우측 상단 [+ 업로드] → [동영상 업로드] → [파일 선택]으로 올려.
7. 설명 = title + 빈 줄 + body, 정보 태그 = tags (가능한 만큼). 카테고리는 '뷰티' 또는 '패션·뷰티' 계열로, 공개 설정은 전체 공개로 등록해.
8. 올린 클립 제목과 링크를 보고해.
로그인·인증 화면이 나오거나 업로드 메뉴를 못 찾으면 멈추고 보고해. 다른 계정·채널로 올리지 마.
```

---

## 2. 샤오홍슈 루틴

```
너는 맨티스 채널의 샤오홍슈(小红书) 업로드 담당이야.

1. https://raw.githubusercontent.com/bethementis/mentis-publisher/main/outbox/index.json 을 열어.
2. items 중 date 가 오늘 또는 어제이고 platforms 에 "xhs" 가 있는 항목만 골라.
   없으면 "오늘 올릴 샤오홍슈 게시물 없음" 이라고 보고하고 끝내.
3. 각 항목마다:
   a. {base_url}xhs/upload.json 을 열어 title, body, images(장수) 를 읽어.
   b. 샤오홍슈 크리에이터 센터(creator.rednote.com 또는 creator.xiaohongshu.com, 맨티스 계정)에 접속해서
      같은 제목의 노트가 이미 있으면 건너뛰어.
   c. {base_url}xhs/01.jpg 부터 images 장수만큼(02.jpg, 03.jpg …) 순서대로 내려받아.
   d. "上传图文"(이미지 노트)로 새 노트를 만들고 이미지를 01번부터 순서대로 올려.
   e. 제목(标题) = title, 본문(正文) = body 를 그대로 붙여 넣어. 내용은 바꾸지 마.
   f. 발행(发布) 해.
4. 끝나면 올린 노트 제목과 링크를 보고해.

주의: 로그인·인증(휴대폰 인증, 슬라이드 퍼즐) 화면이 나오면 멈추고 나에게 알려줘.
```

---

## 게시물 준비 (사람이 할 일)

- 네이버 클립: 따로 할 것 없음. 쇼츠 영상이 자동으로 준비됨. 제목을 바꾸고 싶으면 post.json 에 `"naver": {"title": "..."}`.
- 샤오홍슈: 게시물 폴더 안에 `zh/` 폴더를 만들고 중국어 카드(01.png …)를 넣고,
  post.json 에 `"xhs": {"title": 중국어 제목 20자 이내, "body": 중국어 본문, "tags": [...]}` 작성.
  둘 중 하나라도 없으면 샤오홍슈만 자동으로 건너뜀.
- 중국어 번역은 Claude에게 "이 게시물 샤오홍슈용으로 번역해줘" 하면 카드별 문구 + 제목·본문·태그를 만들어줌.
