# 어사이드 업로드 루틴 (네이버 클립 · 샤오홍슈)

매일 저녁 GitHub 자동 발행이 끝나면(한국시간 19~20시) `outbox/` 에 업로드용 파일이 생긴다.
어사이드 루틴은 **매일 20:30** 에 돌리고, 아래 프롬프트를 그대로 붙여 넣는다.
처음 1~2번은 루틴 대신 직접 실행해서 화면을 지켜보고, 문제없으면 루틴으로 돌린다.

**보고 이슈:** 루틴은 끝에 GitHub 이슈 https://github.com/bethementis/mentis-publisher/issues/1 에 ```json 보고 댓글을 남긴다.
21:20 저녁 점검이 이 댓글로 "올라갔는지/실패했는지"를 확인하고, 다음 날 06:00 숫자 수집이 조회·좋아요 등을 가져간다.
(이슈 번호는 metrics/settings.json 의 aside_issue. 브라우저에 GitHub bethementis 로그인 필요)

---

## 1. 네이버 클립 루틴 (클립 크리에이터 PC 웹)

- PC에서 클립을 새로 올릴 수 있는 곳은 **클립 크리에이터 PC 웹(clipcreators.naver.com/web)** 뿐 (2026-11 확인).
  블로그 PC 에디터·clip.naver.com 에서는 새 클립 생성 불가 (블로그 앱 전용).
- 맨티스 계정: 네이버 블로그 blog.naver.com/bethementis, 클립 채널 MENTIS (@bethementis)

### 루틴 프롬프트 (매일 20:40)
```
너는 맨티스 채널의 네이버 클립 업로드 담당이야. 클립은 반드시 클립 크리에이터 PC 웹에서 맨티스 채널(@bethementis)로 올려.
1. https://raw.githubusercontent.com/bethementis/mentis-publisher/main/outbox/index.json 을 열어.
2. items 중 date 가 오늘 또는 어제이고 platforms 에 "naver" 가 있는 항목만 골라. folder 이름에 TEST 가 들어간 항목은 제외해. 없으면 업로드는 하지 말고 9~10번(숫자 읽기·보고 댓글, upload 는 "none")만 하고 끝내.
3. 각 항목마다 {base_url}naver/upload.json 에서 title, body, tags 를 읽어.
4. https://clipcreators.naver.com/web 에 접속해서 로그인된 채널이 MENTIS(@bethementis)인지 확인해. 아니거나 로그인이 필요하면 올리지 말고 멈추고 보고해. 로그인 화면에 다른 아이디가 자동으로 채워져 있어도 절대 로그인하지 마.
5. 콘텐츠 목록에 같은 제목(설명 첫 줄)의 영상이 이미 있으면 건너뛰어.
6. {base_url}naver/short.mp4 를 내려받아 우측 상단 [+ 업로드] → [동영상 업로드] → [파일 선택]으로 올려.
7. 설명 = title + 빈 줄 + body, 정보 태그 = tags (가능한 만큼). 카테고리는 '뷰티' 또는 '패션·뷰티' 계열로, 공개 설정은 전체 공개로 등록해.
8. 올린 클립 제목과 링크를 보고해.
9. 클립 크리에이터 콘텐츠 목록(또는 통계 화면)에서 최근 7일 안에 올린 클립들의 조회수·좋아요·댓글 수를 읽어. 화면에 없는 숫자는 null 로 둬. 숫자를 추측하지 마.
10. 마지막으로 보고 이슈 https://github.com/bethementis/mentis-publisher/issues/1 를 열고, 아래 형식 그대로 댓글을 하나 남겨 (```json 줄과 ``` 줄 포함). 올릴 게 없었거나 멈췄어도 반드시 남겨.
```json
{"aside": "naver", "date": "오늘 날짜 YYYY-MM-DD", "upload": "ok 또는 skip(이미 있음) 또는 none(올릴 것 없음) 또는 fail", "title": "올린 클립 제목", "url": "올린 클립 링크", "reason": "fail·skip 이면 이유, 아니면 빈칸", "stats": [{"title": "클립 제목", "posted": "YYYY-MM-DD", "views": 0, "likes": 0, "comments": 0}]}
```
로그인·인증 화면이 나오거나 업로드 메뉴를 못 찾으면 업로드는 멈추고, upload 를 "fail", reason 에 무슨 화면이었는지 적어서 10번 보고는 남겨. 다른 계정·채널로 올리지 마.
```

---

## 2. 샤오홍슈 루틴 (매일 20:30)

```
너는 맨티스 채널의 샤오홍슈(小红书) 업로드 담당이야. 반드시 맨티스 계정(User6AE6A4F3, 또는 닉네임에 "Mentis"가 들어간 계정)으로만 올려.

1. https://raw.githubusercontent.com/bethementis/mentis-publisher/main/outbox/index.json 을 열어.
2. items 중 date 가 오늘 또는 어제이고 platforms 에 "xhs" 가 있는 항목만 골라. folder 이름에 TEST 가 들어간 항목은 제외해.
   없으면 업로드는 하지 말고 5~6번(숫자 읽기·보고 댓글, upload 는 "none")만 하고 끝내.
3. 각 항목마다:
   a. {base_url}xhs/upload.json 을 열어 type, title, body, images(장수) 를 읽어. type 이 "video" 면 영상 노트, 아니면 이미지 노트야.
   b. 샤오홍슈 크리에이터 센터(creator.rednote.com 또는 creator.xiaohongshu.com)에 접속해서 로그인된 계정이
      맨티스 계정(User6AE6A4F3 또는 닉네임에 "Mentis")인지 확인해. 아니면 올리지 말고 멈춰.
   c. 같은 제목의 노트가 이미 있으면 건너뛰어.
   d. 이미지 노트: {base_url}xhs/01.jpg 부터 images 장수만큼(02.jpg, 03.jpg …) 순서대로 내려받아
      "上传图文"(이미지 노트)로 새 노트를 만들고 이미지를 01번부터 순서대로 올려.
   e. 영상 노트(type "video"): {base_url}xhs/video.mp4 를 내려받아 "上传视频"(영상 노트)로 새 노트를 만들어 올려. 표지는 기본값 그대로 둬.
   f. 제목(标题) = title, 본문(正文) = body 를 그대로 붙여 넣어. 내용은 바꾸지 마. 샤오홍슈가 추천하는 태그·话题는 추가하지 마.
   g. 공개 범위는 公开可见(전체 공개)로 하고 발행(发布) 해.
4. 끝나면 올린 노트 제목과 링크를 보고해.
5. 크리에이터 센터의 노트 관리(笔记管理) 또는 데이터(数据) 화면에서 최근 7일 안에 올린 노트들의
   조회(浏览/观看)·좋아요(点赞)·저장(收藏)·댓글(评论)·공유(分享) 수를 읽어. 화면에 없는 숫자는 null. 추측하지 마.
6. 마지막으로 보고 이슈 https://github.com/bethementis/mentis-publisher/issues/1 를 열고, 아래 형식 그대로 댓글을 하나 남겨 (```json 줄과 ``` 줄 포함).
   올릴 게 없었거나 멈췄어도 반드시 남겨.
```json
{"aside": "xhs", "date": "오늘 날짜 YYYY-MM-DD", "upload": "ok 또는 skip(이미 있음) 또는 none(올릴 것 없음) 또는 fail", "title": "올린 노트 제목", "url": "올린 노트 링크", "reason": "fail·skip 이면 이유, 아니면 빈칸", "stats": [{"title": "노트 제목", "posted": "YYYY-MM-DD", "views": 0, "likes": 0, "saves": 0, "comments": 0, "shares": 0}]}
```

주의: 로그인·인증(휴대폰 인증, 슬라이드 퍼즐) 화면이 나오거나 맨티스 계정이 아니면 업로드는 멈추고,
upload 를 "fail", reason 에 무슨 화면이었는지 적어서 6번 보고는 남겨. 다른 계정으로 올리지 마.
```

---

## 게시물 준비 (사람이 할 일)

- 네이버 클립: 따로 할 것 없음. 쇼츠 영상이 자동으로 준비됨. 제목을 바꾸고 싶으면 post.json 에 `"naver": {"title": "..."}`.
- 샤오홍슈: 게시물 폴더 안에 `zh/` 폴더를 만들고 중국어 카드(01.png …)를 넣고,
  post.json 에 `"xhs": {"title": 중국어 제목 20자 이내, "body": 중국어 본문, "tags": [...]}` 작성.
  둘 중 하나라도 없으면 샤오홍슈만 자동으로 건너뜀.
- 중국어 번역은 Claude에게 "이 게시물 샤오홍슈용으로 번역해줘" 하면 카드별 문구 + 제목·본문·태그를 만들어줌.
