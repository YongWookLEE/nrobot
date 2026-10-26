# 앤로보틱스 웹 견적서 (임시 시연판)

(주)앤로보틱스 영업 담당자(3명 안팎, 하루 견적 5건 정도)가 거래처 견적서를 PDF·Excel로 만드는 웹앱이다.
- 기술: Next.js 16(App Router) + TypeScript strict, Vercel 무료(Hobby) 시연용.
- 기존 Windows EXE·Flask 웹 1.0을 대체한다. **기존 계산식과 규칙은 그대로**, 결과물은 기존과 **거의 똑같이** 만든다.
- 서버는 상태가 없다. DB·계정·관리자 화면은 없고, 공용 비밀번호 하나로 막는다.
- 이 폴더가 유일한 원본이다(원격: 비공개 `YongWookLEE/nrobot`).

## 프로젝트 구조

```
nrobot-web/
├── AGENTS.md / CLAUDE.md        ← 이 문서(두 파일 내용 동일)
├── 계획/
│   ├── spec.md                  ← 무엇을 만드는가(기준). 충돌 시 이 문서가 이긴다
│   ├── plan.md                  ← 작업 순서·각 작업의 계약·의존 관계
│   ├── handoff.md               ← 꼭 지킬 규칙·결정 이유·도메인 모델·향후 범위
│   └── 진행상황.md               ← 끝난 일/남은 일/주의점/실행 방법 ← 먼저 읽을 것
├── src/
│   ├── domain/                  ← 계산·입력 검증·표기(순수 TS, 화면·서버 공용)
│   ├── numbering/               ← 견적번호(브라우저 저장, 나중에 DB로 교체할 경계)
│   ├── pricelists/              ← 가격표 xlsx 해석·변환·서버 로더
│   ├── auth/ + proxy.ts         ← 공용 비밀번호 입장(서명 쿠키)
│   ├── staff/                   ← STAFF_CONFIG 환경 변수 읽기·검증
│   ├── output/                  ← PDF·Excel 생성기 (합성 입력 비교 모양 승인 완료)
│   ├── server/                  ← 인증·입력 크기 제한·파일 생성 응답 경계
│   └── app/                     ← 입장 화면·조회/생성 API (랜딩·견적 입력 화면 미구현)
├── scripts/prepare-data.ts      ← 빌드 전 가격표 변환(private/prices → generated/pricelists)
├── tools/golden/generate.py     ← 기존 Python 코드로 기준 정답 생성(일회성)
├── tools/compare/               ← 기존/새 PDF 비교·실제 예시 입력 복원 (산출물은 private)
├── tests/golden/, tests/fixtures/ ← 기준 정답·합성 시험 엑셀(가짜 데이터)
├── assets/                      ← KoPub 글꼴(무료)·로고·기본 열 비율
├── private/   (git 제외)        ← 가격표 원본, 맑은 고딕, 기존 견적서 예시, 실제 가격표 정답, 비교 산출물
├── generated/ (git 제외)        ← 가격표 변환 산출물
└── .env       (git 제외)        ← APP_PASSWORD, STAFF_CONFIG (형식은 .env.example)
```

## 꼭 지킬 규칙

1. **계산식·번호 규칙을 바꾸지 않는다.**
   - 원 단위 사사오입, 줄마다 반올림 후 합산.
   - ④⑤는 5천만 원 이상(같을 때 포함)이면 2% 할인하고, 조달수수료 0.54%는 절대 더하지 않는다.
   - 금액에 부동소수점을 쓰지 않는다.
   - `tests/golden/`은 기존 프로그램의 출력이다. 정답 파일을 고쳐서 검사를 통과시키는 것은 금지다.
2. **개인정보·회사 자료를 git에 넣지 않는다.**
   - 대상: 실제 담당자 이름·휴대폰, 가격표 원본·변환물, 맑은 고딕, 기존 견적서 예시.
   - 커밋 전에 `git ls-files`와 `git status`를 확인한다. 문서·검사 코드에도 실제 값을 쓰지 않는다.
3. **모든 페이지·API는 비밀번호 뒤에 있다.** 예외는 `/enter`, `/api/enter`, 정적 파일뿐이다. `APP_PASSWORD`가 없으면 전원 차단한다.
4. **서버에 아무것도 저장하지 않는다.** 번호 이력·입력 초안은 브라우저에 둔다.
5. `nrobot-web` 밖의 경로를 빌드·실행 코드에서 참조하지 않는다. 예외는 기준 정답 생성 도구다.
6. 모양(PDF 배치)은 사용자가 비교 그림을 보고 승인해야 완료다.
7. 검사 명령 `npm run lint && npm run typecheck && npm test && npm run build`가 모두 0이어야 한다. `build`에는 `private/`가 필요하다.
8. 배포 번들에는 비공개 원본 가격표·견적 예시·환경 변수 파일을 넣지 않는다. `node tests/api/check-traces.mjs`로 필요한 변환 자료·글꼴·로고 포함과 원본 제외를 함께 확인한다.

## 작업 전에 읽을 것

- 항상: `계획/진행상황.md`, 그다음 `계획/spec.md`에서 해당 절.
- **PDF·Excel 작업 전**
  - 기존 코드 `../nrobot_full/web_quote/core/pdf_quote.py`, `xlsx_quote.py`를 읽는다. 기준 코드이며 읽기 전용이다.
  - `private/compare/legacy/`의 기존 결과를 본다.
- **가격표 관련 작업 전**: `src/pricelists/`의 짝수 반올림·Python 합계 재현 이유(파일 주석)와 EMF 사진 처리를 확인한다.
- **번호 작업 전**: `src/numbering/types.ts`의 경계 설명을 읽는다. record는 파일 생성이 모두 성공한 뒤에만 호출한다.
- **Next.js 코드 작성 전**: 이 버전은 이전 버전과 다르다. 요청 가로채기는 `proxy.ts`이고, `next.config`에 `cacheComponents`가 켜져 있다. `node_modules/next/dist/docs/`를 먼저 읽는다.

## 문제 처리

- **즉시 사용자에게 알릴 것**
  - 기준 정답과 금액·번호가 다르게 나오는 경우.
  - 개인정보·회사 자료가 git에 들어간 경우(이미 푸시했다면 더 급하다).
  - 비밀번호 없이 데이터에 접근되는 경우.
- 그 밖의 문제는 `계획/진행상황.md`의 '알려진 문제'에 기록한다.
