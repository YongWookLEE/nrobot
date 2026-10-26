# 앤로보틱스 웹 견적서 (임시 시연판 v0.1)

(주)앤로보틱스 영업 담당자가 거래처 견적서를 **PDF·Excel**로 만드는 웹앱입니다.
기존 Windows 프로그램과 Flask 웹 1.0을 대체하며, 계산식·번호 규칙과 결과물 모양은 기존과 같습니다.

- 공용 비밀번호 하나로 모든 화면과 API를 막습니다. 개인 계정·관리자 화면·DB는 없습니다.
- 서버는 아무것도 저장하지 않습니다. 입력 초안·견적번호 이력·휴대폰 수정값은 **지금 쓰는 브라우저**에만 저장됩니다.
- Vercel 무료(Hobby) 요금제에 올리는 시연판입니다.

## 기능

| 화면 | 내용 |
|---|---|
| `/enter` | 공용 비밀번호 입력. 맞으면 서명 쿠키를 받아 **30일간** 다시 묻지 않습니다. |
| `/` | 입장 후 처음 화면(랜딩페이지). '견적서 작성'을 누르면 입력 화면으로 갑니다. |
| `/quote` | 견적 입력 화면. 아래 기능이 모두 있습니다. |

- 견적서 5종: ① 부가세 표시, ② 부가세 미포함, ③ 비용 분리(재료비·노무비·경비), ④⑤ 영업1·2팀 제품 견적.
- ①②③은 출입통제 기준가격표에서, ④⑤는 영업팀 제품가격표에서 품목을 골라 넣습니다.
  - 제품 줄은 가격표와 연동됩니다. 가격표가 바뀌면 화면을 열 때 새 값으로 바뀌고 바뀐 줄을 알려 줍니다.
- 하단 합계를 실시간으로 계산합니다(서버와 같은 계산 코드).
- 저장 형식: PDF, Excel, PDF + Excel 함께(같은 견적번호).
- 견적번호 `NSFF0-작성일-NNN` 자동 발급. 직접 고칠 수 있고, **파일 생성에 성공했을 때만** 번호를 사용한 것으로 기록합니다.
- 입력 자동 저장·복원, '입력내용 임시 저장'·'임시 저장 불러오기', 담당자 휴대폰 수정값 기억.
- 휴대폰 화면 폭(800px 이하)에서도 쓸 수 있습니다.

## 사용 기술

- Next.js 16(App Router) + TypeScript(strict) + Tailwind CSS 4
- PDF: PDFKit, Excel: ExcelJS, 가격표 사진 축소: sharp
- 검사: Vitest, ESLint, Playwright(실제 브라우저 확인)

> 이 Next.js 버전은 이전 버전과 다릅니다. 요청 가로채기는 `src/proxy.ts`이고, `next.config.ts`에 `cacheComponents`가 켜져 있습니다.
> 코드를 고치기 전에 `node_modules/next/dist/docs/`를 확인하세요.

## 폴더 구조

```
├── 계획/                  계획 문서 (spec.md가 기준, 진행상황.md를 먼저 읽기)
├── src/
│   ├── app/               화면(/, /enter, /quote)과 API(/api/*)
│   ├── ui/                견적 입력 화면 부품과 화면 규칙(draft.ts·generate.ts)
│   ├── domain/            계산·입력 검증·표기 (화면·서버 공용, 순수 TypeScript)
│   ├── numbering/         견적번호 발급 경계 (지금은 브라우저 저장, 나중에 DB로 교체)
│   ├── pricelists/        가격표 엑셀 해석·변환·서버 로더
│   ├── output/            PDF·Excel 생성기
│   ├── auth/ + proxy.ts   공용 비밀번호 입장(서명 쿠키)
│   ├── staff/             담당자 설정(STAFF_CONFIG) 읽기·검증
│   └── server/            API 공통 처리(입장 확인·크기 제한·파일 응답)
├── scripts/prepare-data.ts  빌드 전 가격표 변환 (private/prices → generated/pricelists)
├── tests/                 자동 검사 (기준 정답 tests/golden은 고치지 않음)
├── tools/                 기준 정답 생성·모양 비교 도구
├── assets/                KoPub 글꼴·로고·기본 열 비율
├── private/   (git 제외)  가격표 원본, 맑은 고딕, 비교 자료
├── generated/ (git 제외)  가격표 변환 산출물
└── .env       (git 제외)  비밀번호·담당자 설정
```

## 개발 시작

준비물: Node 22 이상, npm.

1. 의존성 설치

   ```bash
   npm install
   ```

2. 비공개 자료를 `private/`에 둡니다(저장소에 없음, 회사에서 받기).

   | 넣을 위치 | 원본 |
   |---|---|
   | `private/prices/access.xlsx` | `260730_출입통제 기준가격_06.xlsx` |
   | `private/prices/catalog.xlsx` | `(주)앤로보틱스_ 2026년도 견적서 양식.xlsx` |
   | `private/fonts/malgun.ttf`, `malgunbd.ttf` | Windows `C:\Windows\Fonts`의 맑은 고딕 |

   맑은 고딕이 없으면 ①②③ PDF를 만들 수 없습니다.

3. 환경 변수 파일을 만듭니다. 형식은 `.env.example`을 따릅니다.

   ```bash
   cp .env.example .env
   ```

   - `APP_PASSWORD`: 입장 비밀번호. 비어 있으면 아무도 들어갈 수 없습니다. 쿠키 서명에도 쓰이므로 길고 무작위로 정하세요.
   - `STAFF_CONFIG`: 담당자 명단 JSON 배열을 **한 줄로** 적습니다. `start`는 그 담당자의 하루 견적번호 시작값(1~999)입니다.

4. 가격표를 변환하고 개발 서버를 띄웁니다.

   ```bash
   npm run prepare-data
   npm run dev
   ```

   http://localhost:3000 에 접속해 비밀번호를 넣습니다.

## 확인 명령

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

모두 종료 코드 0이어야 합니다. `npm test`에는 개인정보·회사 자료가 git에 들어가지 않았는지 보는 저장소 경계 검사(`tests/repo-boundary.test.ts`)가 포함됩니다. `build`는 `private/prices`가 있어야 성공합니다. 빌드 후 아래 확인도 실행합니다.

```bash
node tests/api/check-traces.mjs   # 배포 번들에 변환 자료·글꼴·로고 포함, 원본·환경 변수 제외 확인
node tests/api/http-smoke.mjs     # 빌드 서버를 띄워 입장·조회·내려받기를 HTTP로 확인
node tests/ui/browser-smoke.mjs   # 실제 브라우저로 입장→랜딩→견적 작성, 5종 내려받기·번호·복원·휴대폰 화면 확인
```

마지막 두 검사는 가짜 비밀번호·담당자를 주입해 띄우므로 `.env`의 실제 값을 쓰지 않습니다.
브라우저 검사가 처음이면 `npx playwright install chromium`으로 브라우저를 받습니다.

## 지켜야 할 규칙

- 계산식·번호 규칙을 바꾸지 않습니다(원 단위 사사오입, 줄마다 반올림 후 합산, ④⑤ 5천만 원 이상 2% 할인, 조달수수료는 더하지 않음).
- 개인정보·회사 자료(실제 담당자 연락처, 가격표 원본·변환물, 맑은 고딕, 실제 견적서)는 git에 넣지 않습니다. 커밋 전에 `git status`를 확인하세요.
- 견적번호는 브라우저별로 발급하므로 PC끼리 번호가 겹칠 수 있습니다(시연판의 알려진 제한).
- 맑은 고딕을 서버에서 PDF에 넣는 것은 정식 운영 전에 라이선스를 다시 검토해야 합니다.

## 안내 문서

- `docs/배포가이드.md`: 비공개 자료 준비부터 Vercel 배포, 가격표·비밀번호·담당자 변경, 문제 해결까지.
- `docs/사용방법.md`: 영업 담당자용 사용 순서.
- `docs/릴리즈노트.md`: 판마다 기능·제한·검사 결과.

자세한 요구사항은 `계획/spec.md`, 진행 상황과 남은 일은 `계획/진행상황.md`에 있습니다.
