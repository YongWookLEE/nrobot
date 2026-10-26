// 실행: node tests/api/http-smoke.mjs (먼저 next build). 가짜 입장정보·담당자만 주입한다.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";

const port = 3198;
const base = `http://127.0.0.1:${port}`;
const password = "http-smoke-only-password";
const server = spawn(process.execPath, [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: process.cwd(), windowsHide: true, stdio: "ignore",
  env: { ...process.env, APP_PASSWORD: password, STAFF_CONFIG: JSON.stringify([{ id: "a", name: "홍길동", title: "차장", phone: "010-0000-0001", start: 1 }]) },
});

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("시험 서버가 시작되지 않았습니다.");
    try {
      const response = await fetch(`${base}/enter`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(ready, "시험 서버 응답 시간 초과");
  const endpoints = ["access-catalog", "catalog", "staff", "catalog-image/missing", "generate"];
  for (const name of endpoints) {
    const response = await fetch(`${base}/api/${name}`, { method: name === "generate" ? "POST" : "GET" });
    assert.equal(response.status, 401);
  }
  const entered = await fetch(`${base}/api/enter`, { method: "POST", body: JSON.stringify({ password }), headers: { "content-type": "application/json" } });
  assert.equal(entered.status, 200);
  const cookie = entered.headers.get("set-cookie")?.split(";")[0];
  assert(cookie);
  const headers = { cookie, "content-type": "application/json" };
  for (const name of ["access-catalog", "catalog", "staff"]) {
    const response = await fetch(`${base}/api/${name}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const products = await (await fetch(`${base}/api/catalog`, { headers })).json();
  assert(!Object.hasOwn(products, "images"));
  const imageId = products.entries.flatMap((item) => item.imageIds ?? [])[0];
  if (imageId) {
    const response = await fetch(`${base}/api/catalog-image/${imageId}`, { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^image\//);
  }
  assert.equal((await fetch(`${base}/api/catalog-image/missing`, { headers })).status, 404);
  for (const format of ["pdf", "xlsx"]) {
    const response = await fetch(`${base}/api/generate`, {
      method: "POST", headers,
      body: JSON.stringify({ format, quoteType: "vat", customer: "시험 거래처", title: "HTTP 확인", number: "NSFF0-20261026-001", date: "2026-10-26", staffId: "a", items: [{ name: "시험 품목", unit: "식", qty: "1", price: "1000" }] }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /filename\*=UTF-8''/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), format === "pdf" ? "%P" : "PK");
  }
  console.log("실제 HTTP 확인 통과: 미입장 5경로 차단, 로그인, 목록·담당자·사진 조회, PDF·Excel 내려받기");
} finally {
  server.kill();
}
