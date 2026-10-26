# PDF 비교 자료 만들기

프로젝트 폴더에서 다음 명령을 실행한다. Python에 `pymupdf`가 설치되어 있어야 하며, Node 의존성과 `private/`의 글꼴·기존 출력·실제 예시, `generated/pricelists`가 필요하다.

```powershell
python tools/compare/pdf.py
```

이 명령은 같은 입력으로 새 PDF를 만든 뒤, 기존 문서를 왼쪽에 놓은 비교 PNG를 생성한다. 합성 입력 8종과 `private/reference/`의 PDF·Excel 5쌍이 대상이다. 쪽수와 줄 금액·합계·견적가·한글 금액 문자열이 두 PDF에 모두 있는지 검사한다. 불일치하거나 입력을 복원하지 못한 대상이 있으면 종료 코드는 1이다. 생성 단계가 실패하면 이전 결과로 검증을 계속하지 않는다.

생성과 비교를 나눠 실행하려면 다음 명령을 쓴다.

```powershell
npx.cmd tsx tools/compare/render.ts
python tools/compare/pdf.py --skip-render
```

`--dpi 144`로 그림 해상도를 바꿀 수 있다(72~200, 기본 96). `--root`는 프로젝트 폴더를 지정하며 `--help`에서 설명을 볼 수 있다.

산출물은 전부 Git에서 제외된 `private/compare/`에 둔다.

- `new/`: 합성 입력의 새 PDF.
- `reference-original/`, `reference-new/`: 실제 예시의 기존·새 PDF와 복원한 입력 JSON. 개인정보와 회사 자료가 포함되므로 Git에 넣지 않는다.
- `images/`: `vat-3-1.png` 같은 합성 비교 그림과 `reference-1-1.png` 같은 실제 예시 비교 그림. 위쪽에 ‘기존 견적서’, ‘새 견적서’를 표시한다.
- `manifest.json`: 비교 대상과 금액 문자열.
- `report.json`: 쪽수, 빠진 금액 문자열, 생성 그림 목록, 입력 복원 누락.

실제 예시 입력은 같은 이름의 Excel에서 읽는다. 줄 수식의 셀 참조·적용률과 저장된 계산값을 읽고, 복원한 줄 금액과 최종 금액이 원본 계산값과 같은지 확인한다. 빈 연락처도 그대로 유지한다. 영업팀 예시는 파일명의 ‘1팀’·‘2팀’을 구분하고, 품목명이 현재 가격표의 한 항목과 정확히 같은 경우에만 그 서식과 사진을 사용한다. 여러 시트, 다른 계산식, 품목명이 달라진 예시는 추측하지 않고 복원 실패로 보고한다. 원본 PDF와 Excel은 수정하지 않는다.

자동 검사는 금액·쪽수 검증이다. 글자 넘침·표 선·줄바꿈·사진 위치는 사람이 그림을 보고 확인해야 한다. 2026-10-26 승인된 합성 입력 8종·11쪽과 실제 예시 5종의 추가 승인은 구분한다.

도구 자체의 판정 검사는 다음과 같이 실행한다.

```powershell
npm.cmd test -- tests/compare
python -m unittest discover -s tests/compare -p "test_*.py" -v
```
