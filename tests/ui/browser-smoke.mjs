// 실행: node tests/ui/browser-smoke.mjs (먼저 npm run build). 가짜 입장정보·담당자로 빌드 서버를 띄워 실제 브라우저로 확인한다.
// 확인: 최초 비밀번호 → 랜딩 → 견적 작성, 쿠키 30일 유지, 5종 내려받기·번호 증가, 실패 시 번호 유지, 새로고침 복원, 휴대폰 화면, 나가기.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "@playwright/test";

const port = 3199;
const base = `http://localhost:${port}`;
const password = "browser-smoke-only-password";
const staff = [
  { id: "a", name: "홍길동", title: "차장", phone: "010-0000-0001", start: 1 },
  { id: "b", name: "김철수", title: "대리", phone: "010-0000-0002", start: 10 },
];
const server = spawn(process.execPath, [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "start", "--hostname", "localhost", "--port", String(port)], {
  cwd: process.cwd(), windowsHide: true, stdio: "ignore",
  env: { ...process.env, APP_PASSWORD: password, STAFF_CONFIG: JSON.stringify(staff) },
});

/** 시험 서버가 응답할 때까지 기다린다. */
async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("시험 서버가 시작되지 않았습니다.");
    try {
      if ((await fetch(`${base}/enter`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("시험 서버 응답 시간 초과");
}

/** 만들기를 눌러 내려받은 파일 이름 목록과 상태 문구를 돌려준다. */
async function submitAndCollect(page, count) {
  const downloads = [];
  const listener = (d) => downloads.push(d.suggestedFilename());
  page.on("download", listener);
  await page.getByRole("button", { name: /만들기$/ }).click();
  await page.getByTestId("status").filter({ hasText: /견적서를 저장했습니다|입력내용은 유지/ }).waitFor();
  for (let i = 0; i < 50 && downloads.length < count; i++) await page.waitForTimeout(100);
  page.off("download", listener);
  return { downloads, status: (await page.getByTestId("status").innerText()).replace(/\n?[^\n]*다시 내려받기.*$/s, "") };
}

const numberInput = (page) => page.locator("#quote-number");
const serial = (n) => Number(n.slice(-3));

const results = [];
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  // 1. 최초 접속은 비밀번호 화면, 틀린 비밀번호 거부
  await page.goto(`${base}/quote`);
  assert.equal(new URL(page.url()).pathname, "/enter");
  // 화면이 준비되기 전에 누르면 브라우저 기본 제출이 되므로 기다린다.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("비밀번호").fill("wrong");
  await page.getByRole("button", { name: "입장" }).click();
  await page.getByRole("alert").filter({ hasText: "비밀번호를 확인하세요" }).waitFor();
  // 2. 맞는 비밀번호 → 랜딩 → 견적서 작성
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "입장" }).click();
  await page.waitForURL(`${base}/`);
  await page.getByRole("heading", { name: "앤로보틱스 견적서" }).waitFor();
  const cookie = (await context.cookies()).find((c) => c.httpOnly);
  assert(cookie, "입장 쿠키가 없습니다.");
  const days = (cookie.expires * 1000 - Date.now()) / 86400000;
  assert(days > 29.9 && days <= 30.01, `쿠키 유지 기간이 30일이 아닙니다: ${days}`);
  await page.getByRole("link", { name: "견적서 작성" }).click();
  await page.waitForURL(`${base}/quote`);
  results.push("최초 비밀번호 → 랜딩 → 견적서 작성 이동, 쿠키 30일");

  // 3. 같은 브라우저로 다시 열면 입장 상태 유지
  const again = await context.newPage();
  await again.goto(`${base}/quote`);
  assert.equal(new URL(again.url()).pathname, "/quote");
  await again.close();
  results.push("재접속 시 입장 유지");

  // 4. ① 출입통제 품목 추가 + 함께 저장
  await page.getByLabel("거래처 *").fill("시험 거래처");
  await page.getByLabel("견적 제목 *").fill("브라우저 확인");
  const first = await numberInput(page).inputValue();
  assert.match(first, /^NSFF0-\d{8}-001$/);
  const accessSelect = page.getByLabel("품목 선택", { exact: true });
  await accessSelect.locator("option").nth(1).waitFor({ state: "attached" });
  await accessSelect.selectOption({ index: 1 });
  await page.getByRole("button", { name: "선택 품목 추가" }).click();
  assert.notEqual(await page.getByLabel("품목명", { exact: true }).first().inputValue(), "");
  await page.getByLabel("저장 형식").selectOption("both");
  let r = await submitAndCollect(page, 2);
  assert.equal(r.status.split("\n")[0], `견적서를 저장했습니다. ${first}`);
  assert.equal(await page.getByRole("link", { name: /다시 내려받기$/ }).count(), 2);
  assert.deepEqual(r.downloads.sort(), ["견적서_시험 거래처.pdf", "견적서_시험 거래처.xlsx"]);
  await page.waitForFunction((n) => document.querySelector("#quote-number").value !== n, first);
  assert.equal(serial(await numberInput(page).inputValue()), 2);
  results.push("① 출입통제 품목 추가, PDF+Excel 같은 번호로 2개 내려받기, 번호 001→002");

  // 5. 실패하면 번호를 쓰지 않는다: 함께 저장 중 Excel만 실패
  await page.route("**/api/generate", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    if (body.format === "xlsx") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "견적서 생성 확인에 실패했습니다." }) });
    return route.continue();
  });
  r = await submitAndCollect(page, 0);
  assert.equal(r.status, "견적서 생성 확인에 실패했습니다.\n입력내용은 유지되어 있습니다.");
  assert.deepEqual(r.downloads, []);
  assert.equal(serial(await numberInput(page).inputValue()), 2);
  await page.unroute("**/api/generate");
  // 화면 검사 실패도 같다
  await page.getByLabel("견적 제목 *").fill("");
  r = await submitAndCollect(page, 0);
  assert.equal(r.status, "거래처와 견적 제목을 입력하세요.\n입력내용은 유지되어 있습니다.");
  assert.equal(serial(await numberInput(page).inputValue()), 2);
  await page.getByLabel("견적 제목 *").fill("브라우저 확인");
  results.push("생성 실패(서버 오류·입력 오류) 시 입력·번호 유지, 내려받기 없음");

  // 6. ② 부가세 미포함 PDF
  await page.getByLabel("출력 양식").selectOption("total");
  await page.getByLabel("저장 형식").selectOption("pdf");
  r = await submitAndCollect(page, 1);
  assert.match(r.status, /-002$/);
  assert.deepEqual(r.downloads, ["견적서_시험 거래처.pdf"]);

  // 7. ③ 비용 분리 Excel: 자동 노무비·경비
  await page.getByLabel("출력 양식").selectOption("cost");
  await page.getByLabel("저장 형식").selectOption("xlsx");
  await page.getByRole("button", { name: "＋ 품목 추가" }).click();
  const lastRow = page.getByTestId("item-row").last();
  await lastRow.getByLabel("품목명", { exact: true }).fill("직접 입력 품목");
  await lastRow.getByLabel("재료비").fill("1000");
  assert.equal(await lastRow.getByLabel("노무비").inputValue(), "2,813");
  assert.equal(await lastRow.getByLabel("경비").inputValue(), "84");
  r = await submitAndCollect(page, 1);
  assert.match(r.status, /-003$/);
  assert.deepEqual(r.downloads, ["견적서_시험 거래처.xlsx"]);
  results.push("② PDF, ③ Excel(노무비·경비 자동 계산) 내려받기, 번호 002·003 순서");

  // 8. ④ 제품 견적: 품목을 모두 지우고 제품 추가
  await page.getByLabel("출력 양식").selectOption("catalog");
  while ((await page.getByTestId("item-row").count()) > 1) await page.getByRole("button", { name: /^1번 품목 삭제$/ }).click();
  await page.getByRole("button", { name: /^1번 품목 삭제$/ }).click();
  const productSelect = page.getByLabel("검색 결과", { exact: true });
  await productSelect.locator("option").nth(1).waitFor({ state: "attached" });
  // 단가가 있는 제품을 고른다
  const options = await productSelect.locator("option").all();
  let picked = false;
  for (let i = 1; i < options.length && !picked; i++) {
    await productSelect.selectOption({ index: i });
    picked = !(await page.getByTestId("catalog-preview").innerText()).includes("직접 입력 필요");
  }
  assert(picked, "단가가 있는 제품이 없습니다.");
  await page.getByRole("button", { name: "선택 제품을 품목에 추가" }).click();
  assert.equal(await page.getByLabel("품목명", { exact: true }).first().getAttribute("readonly"), "");
  assert.match(await page.getByLabel("참고사항").inputValue(), /^1\. 해당 건에 대한 견적가격입니다\./);
  await page.getByLabel("저장 형식").selectOption("pdf");
  r = await submitAndCollect(page, 1);
  assert.match(r.status, /-004$/);
  // 9. ⑤ 제품 견적 함께 저장
  await page.getByLabel("출력 양식").selectOption("catalog2");
  await page.getByLabel("저장 형식").selectOption("both");
  r = await submitAndCollect(page, 2);
  assert.match(r.status, /-005$/);
  assert.equal(r.downloads.length, 2);
  results.push("④ 제품 연동 PDF, ⑤ 함께 저장 내려받기, 번호 004·005 순서");

  // 10. 새로고침 후 복원 (종류·거래처·연동 줄·번호 이력)
  await page.reload();
  await page.getByLabel("거래처 *").waitFor();
  assert.equal(await page.getByLabel("거래처 *").inputValue(), "시험 거래처");
  assert.equal(await page.getByLabel("출력 양식").inputValue(), "catalog2");
  assert.equal(await page.getByLabel("품목명", { exact: true }).first().getAttribute("readonly"), "");
  await page.getByTestId("status").filter({ hasText: "마지막 작성 내용을 자동으로 불러왔습니다." }).waitFor();
  await page.waitForFunction(() => document.querySelector("#quote-number").value.endsWith("-006"));
  results.push("새로고침 후 입력·연동 줄 복원, 다음 번호 006 유지");

  // 11. 휴대폰 수정값은 담당자별로 기억
  await page.getByLabel("담당자 휴대폰번호").fill("010-0000-0009");
  await page.getByLabel(/김철수 · 010부터/).check();
  assert.equal(await page.getByLabel("담당자 휴대폰번호").inputValue(), "010-0000-0002");
  assert.equal(serial(await numberInput(page).inputValue()), 10);
  await page.getByLabel(/홍길동 · 001부터/).check();
  assert.equal(await page.getByLabel("담당자 휴대폰번호").inputValue(), "010-0000-0009");
  results.push("담당자 변경 시 표시·번호(010부터) 전환, 휴대폰 수정값 기억");

  // 직접 입력 번호는 작성일을 바꾸면 자동 번호로 돌아간다
  const today = await page.getByLabel("작성일 *").inputValue();
  await numberInput(page).fill("직접-1");
  await page.getByText("견적번호 (직접 입력)").waitFor();
  await page.getByLabel("작성일 *").fill("2026-01-02");
  await page.waitForFunction(() => document.querySelector("#quote-number").value === "NSFF0-20260102-001");
  await page.getByText("견적번호 (자동)").waitFor();
  await page.getByLabel("작성일 *").fill(today);
  await page.waitForFunction(() => document.querySelector("#quote-number").value.endsWith("-006"));
  results.push("직접 입력 번호 → 작성일 변경 시 자동 번호 복귀");

  // 12. 휴대폰 화면 폭: 페이지가 가로로 넘치지 않는다 (품목 표는 자체 스크롤)
  for (const pathName of ["/", "/quote"]) {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() });
    await mobile.goto(`${base}${pathName}`);
    await mobile.waitForLoadState("networkidle");
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `${pathName} 휴대폰 화면 가로 넘침 ${overflow}px`);
    await mobile.screenshot({ path: path.join(process.cwd(), "private", `mobile${pathName === "/" ? "-landing" : "-quote"}.png`), fullPage: true }).catch(() => {});
    await mobile.close();
  }
  results.push("휴대폰 폭(390px) 랜딩·입력 화면 가로 넘침 없음");

  // 13. 나가기 → 다시 비밀번호 필요
  await page.getByRole("button", { name: "나가기" }).click();
  await page.waitForURL(`${base}/enter`);
  await page.goto(`${base}/`);
  assert.equal(new URL(page.url()).pathname, "/enter");
  results.push("나가기 후 다시 입장 필요");

  console.log(`실제 브라우저 확인 통과:\n- ${results.join("\n- ")}`);
} finally {
  await browser?.close();
  server.kill();
}
