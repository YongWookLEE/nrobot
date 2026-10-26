import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession, SESSION_COOKIE } from "@/auth/session";
import { parseProductCatalog } from "@/pricelists/catalog";
import { parseAccessCatalog } from "@/pricelists/access";
import { createApi, MAX_REQUEST_BYTES, type ApiDeps } from "@/server/api";
import { renderQuotePdf } from "@/output/pdf";
import { renderQuoteXlsx } from "@/output/xlsx";

const STAFF = [{ id: "a", name: "홍길동", title: "차장", display: "홍길동 차장", phone: "010-0000-0001", start: 1 }];
const PASSWORD = "api-test-password";
let cookie: string;
let deps: ApiDeps;
let catalog: Awaited<ReturnType<typeof parseProductCatalog>>;

beforeAll(async () => {
  cookie = `${SESSION_COOKIE}=${await signSession(PASSWORD)}`;
  catalog = await parseProductCatalog(readFileSync(path.join(process.cwd(), "tests/fixtures/catalog.xlsx")));
  const zip = new JSZip();
  zip.file("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>');
  zip.file("[Content_Types].xml", "<Types/>");
  const xlsx = await zip.generateAsync({ type: "nodebuffer" });
  deps = {
    password: () => PASSWORD,
    loadStaff: () => STAFF,
    loadAccessCatalog: () => parseAccessCatalog(readFileSync(path.join(process.cwd(), "tests/fixtures/access.xlsx"))),
    loadProductCatalog: () => ({ ...catalog.catalog, images: { hidden: "private-path.jpg" } }),
    loadCatalogImage: (id) => {
      const image = catalog.images.get(id);
      return image ? { ...image, contentType: image.ext === "png" ? "image/png" : "image/jpeg" } : null;
    },
    renderPdf: vi.fn(async () => Buffer.from("%PDF-1.7\n%%EOF")),
    renderXlsx: vi.fn(async () => xlsx),
  };
});

function request(body?: unknown, headers: Record<string, string> = {}, authenticated = true) {
  return new Request("http://localhost/api/generate", {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(authenticated ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

function raw(extra: Record<string, unknown> = {}) {
  return {
    format: "pdf", quoteType: "vat", customer: ' 거래/처" ', title: "시험 견적", number: "NSFF0-20261026-001",
    date: "2026-10-26", staffId: "a", staffPhone: "010-0000-0001", items: [{ name: "시험 품목", unit: "식", qty: "1", price: "1000" }], ...extra,
  };
}

describe("인증된 서버 API", () => {
  it("다섯 경로는 쿠키 없음·변조·비밀번호 변경·미설정을 모두 차단한다", async () => {
    for (const password of [PASSWORD, "changed", undefined]) {
      const api = createApi({ ...deps, password: () => password });
      for (const token of [undefined, "broken", cookie]) {
        if (password === PASSWORD && token === cookie) continue;
        const req = request(undefined, token ? { cookie: token } : {}, false);
        for (const response of await Promise.all([api.accessCatalog(req), api.catalog(req), api.staff(req), api.catalogImage(req, "missing"), api.generate(req)])) {
          expect(response.status).toBe(401);
          expect(response.headers.get("cache-control")).toBe("no-store");
        }
      }
    }
  });

  it("목록과 담당자를 반환하고 서버 이미지 파일명은 노출하지 않는다", async () => {
    const api = createApi(deps);
    const access = await api.accessCatalog(request());
    expect(access.status).toBe(200);
    expect((await access.json()).entries.length).toBeGreaterThan(0);
    const products = await (await api.catalog(request())).json();
    expect(Object.keys(products).sort()).toEqual(["entries", "revision", "sheets", "warnings"]);
    expect(JSON.stringify(products)).not.toContain("private-path");
    expect(await (await api.staff(request())).json()).toEqual({ staff: STAFF });
  });

  it("사진은 올바른 MIME으로 내려주고 없는 id는 404다", async () => {
    const api = createApi(deps);
    const id = [...catalog.images.keys()][0];
    const res = await api.catalogImage(request(), id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\/(png|jpeg)$/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(catalog.images.get(id)!.data);
    expect((await api.catalogImage(request(), "../../.env")).status).toBe(404);
  });

  it("형식별 생성, 번호 유지, UTF-8 안전 파일명·no-store 헤더", async () => {
    const api = createApi(deps);
    for (const format of ["pdf", "xlsx"]) {
      const res = await api.generate(request(raw({ format })));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(decodeURIComponent(res.headers.get("content-disposition")!)).toContain(`견적서_거래_처_.${format}`);
      expect(res.headers.get("content-type")).toBe(format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString()).toBe(format === "pdf" ? "%P" : "PK");
    }
    expect(vi.mocked(deps.renderPdf).mock.calls.at(-1)![0].number).toBe("NSFF0-20261026-001");
  });

  it("revision·삭제 연동을 거부하고 정상 연동과 직접 입력 사진을 서버에서 정규화한다", async () => {
    const api = createApi(deps);
    for (const input of [raw({ quoteType: "catalog", catalogRevision: "old" }), raw({ quoteType: "catalog", catalogRevision: catalog.catalog.revision, items: [{ catalogId: "gone" }] })]) {
      expect((await api.generate(request(input))).status).toBe(400);
    }
    const entry = catalog.catalog.entries.find((e) => e.price !== null)!;
    const validId = [...catalog.images.keys()][0];
    const res = await api.generate(request(raw({ quoteType: "catalog", catalogRevision: catalog.catalog.revision, items: [
      { catalogId: entry.id, qty: "2", price: "1", name: "偽", imageIds: ["gone"] },
      { name: "직접 입력", unit: "식", qty: "1", price: "1000", imageIds: ["gone", validId] },
    ] })));
    expect(res.status).toBe(200);
    const sent = vi.mocked(deps.renderPdf).mock.calls.at(-1)![0];
    expect(sent.items[0].name).toBe(entry.name);
    expect(sent.items[0].price).toBe(entry.price);
    expect(sent.items[1].imageIds).toEqual([validId]);
    // 일반 견적도 같은 catalog를 전달하므로 임의 사진 id는 걸러진다.
    await api.generate(request(raw({ items: [{ name: "품목", unit: "식", qty: "1", price: "1", imageIds: ["gone", validId] }] })));
    expect(vi.mocked(deps.renderPdf).mock.calls.at(-1)![0].items[0].imageIds ?? []).not.toContain("gone");
  });

  it("Content-Length 사전 검사와 실제 스트림 바이트 수로 300KB를 제한한다", async () => {
    const api = createApi(deps);
    expect((await api.generate(request(raw(), { "content-length": String(MAX_REQUEST_BYTES + 1) }))).status).toBe(413);
    expect((await api.generate(request(raw(), { "content-length": "9".repeat(30) }))).status).toBe(413);
    const valid = JSON.stringify(raw());
    expect((await api.generate(request(valid + " ".repeat(MAX_REQUEST_BYTES - Buffer.byteLength(valid))))).status).toBe(200);
    for (const contentLength of [undefined, "1"]) {
      const chunks = [new TextEncoder().encode("가".repeat(60_000)), new TextEncoder().encode("가".repeat(60_000))];
      const stream = new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } });
      const req = new Request("http://localhost/api/generate", { method: "POST", headers: { cookie, ...(contentLength ? { "content-length": contentLength } : {}) }, body: stream, duplex: "half" } as RequestInit);
      expect((await api.generate(req)).status).toBe(413);
    }
    expect((await api.generate(request("{"))).status).toBe(400);
  });

  it("손상된 PDF·ZIP·workbook 없음은 500이며 내부 경로는 숨긴다", async () => {
    const empty = await new JSZip().generateAsync({ type: "nodebuffer" });
    for (const [format, bytes] of [["pdf", Buffer.from("bad")], ["xlsx", Buffer.from("PKbad")], ["xlsx", empty]] as const) {
      const api = createApi({ ...deps, renderPdf: async () => bytes, renderXlsx: async () => bytes });
      const res = await api.generate(request(raw({ format })));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "견적서 생성 확인에 실패했습니다." });
    }
    const api = createApi({ ...deps, loadProductCatalog: () => { throw new Error("secret/private.xlsx"); } });
    const res = await api.catalog(request());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("ZIP의 CRC가 틀리면 생성 성공으로 응답하지 않는다", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "workbook-content");
    zip.file("[Content_Types].xml", "content-types");
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    bytes[bytes.indexOf(Buffer.from("workbook-content"))] ^= 1;
    const api = createApi({ ...deps, renderXlsx: async () => bytes });
    const res = await api.generate(request(raw({ format: "xlsx" })));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "견적서 생성 확인에 실패했습니다." });
  });

  it("응답 크기 한도를 넘는 산출물은 내려주지 않는다", async () => {
    const bytes = Buffer.alloc(4_500_000);
    bytes.write("%PDF-1.7");
    const api = createApi({ ...deps, renderPdf: async () => bytes });
    const res = await api.generate(request(raw()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "견적서 생성 확인에 실패했습니다." });
  });

  it("5종 PDF·Excel 실제 생성기 연결과 파일 검증이 성공한다", async () => {
    const api = createApi({ ...deps, renderPdf: renderQuotePdf, renderXlsx: renderQuoteXlsx });
    for (const quoteType of ["vat", "total", "cost", "catalog", "catalog2"]) {
      for (const format of ["pdf", "xlsx"]) {
        const input = raw({ quoteType, format, catalogRevision: catalog.catalog.revision, items: [{ name: "시험 품목", unit: "식", qty: "1.125", price: "1000", material: "1000", labor: "2813", expense: "84" }] });
        const res = await api.generate(request(input));
        expect(res.status).toBe(200);
        const bytes = Buffer.from(await res.arrayBuffer());
        expect(bytes.length).toBeGreaterThan(1000);
        if (format === "xlsx") expect((await JSZip.loadAsync(bytes, { checkCRC32: true })).file("xl/workbook.xml")).not.toBeNull();
        else expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      }
    }
  });
});
