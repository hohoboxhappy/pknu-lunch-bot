# PKNU·행복기숙사 식단 슬랙 봇

부경대 교내 식당 주간 식단표의 `라일락`·`한미르관`과 행복기숙사 식당의 `조식`·`중식`·`석식`을 읽어 슬랙으로 자동 게시하는 봇입니다.

## 동작 개요

- `https://www.pknu.ac.kr/main/399` 목록에서 최신 식단 공지를 찾습니다.
- 공지 본문에서 `라일락`과 `한미르관` 메뉴를 추출합니다.
- `https://happydorm.or.kr/busan/ko/0605/cafeteria/menu/`에서 행복기숙사 조식·중식·석식을 추출합니다.
- 슬랙 Incoming Webhook으로 메시지를 전송합니다.
- GitHub Actions로 평일 오전 8시(KST)에 자동 실행할 수 있습니다.
- 식단표에 `휴일`, `대체 휴일`, `설날`, `휴무`처럼 비운영으로 표시된 날에는 게시하지 않습니다.
- 식단이 없거나 아직 올라오지 않은 평일에는 `오늘 식단이 없습니다. 홈페이지를 확인해 보세요.` 메시지를 전송합니다.
- 정상 식단 게시와 안내 메시지 모두 게시판 홈페이지 주소를 함께 포함합니다.

## 설정

1. 환경 변수 파일을 준비합니다.
2. 슬랙 Incoming Webhook URL을 발급받아 `SLACK_WEBHOOK_URL`에 넣습니다.
3. 필요하면 `PKNU_MENU_URL`을 기본값 대신 다른 공지 목록 URL로 바꿉니다.

## 로컬 실행

```powershell
copy .env.example .env
# 의존성을 설치한 뒤
npm.cmd install
# .env 값을 채운 뒤
node src/index.js
```

로컬에서 한 번만 확인할 때는 아래처럼 dry-run으로 결과를 먼저 볼 수 있습니다.

```powershell
$env:TARGET_DATE='2026-03-26'
node src/index.js --dry-run
```

## GitHub Actions

워크플로는 `.github/workflows/post-menu.yml`에 있습니다.

필수 시크릿:

- `SLACK_WEBHOOK_URL`

선택 환경 변수:

- `PKNU_MENU_URL`
- `TZ`

운영 시에는 `main` 브랜치에 푸시되거나, Actions 화면에서 수동 실행할 수 있습니다.
