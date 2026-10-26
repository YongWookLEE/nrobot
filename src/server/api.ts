// 요청 처리 경계. 도메인 검증과 생성기는 공용으로 사용하고 서버에는 파일을 남기지 않는다.
import JSZip from "jszip";
import { UNAUTHORIZED_MESSAGE } from "@/auth/access";
import { SESSION_COOKIE, verifySession } from "@/auth/session";
import { safeCustomerName, validateQuote, type AccessCatalog, type QuoteInput, type StaffProfile } from "@/domain";
import { renderQuotePdf, type PdfDeps } from "@/output/pdf";
import { renderQuoteXlsx, type XlsxDeps } from "@/output/xlsx";
import { loadAccessCatalog, loadProductCatalog, loadCatalogImage, type StoredProductCatalog } from "@/pricelists/load";
import { loadStaff } from "@/staff";

export const MAX_REQUEST_BYTES = 300 * 1024;
const MAX_RESPONSE_BYTES = 4_500_000;
const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const GENERATION_ERROR = "견적서 생성 확인에 실패했습니다.";

export interface ApiDeps {
  password(): string | undefined;
  loadStaff(): StaffProfile[];
  loadAccessCatalog(): AccessCatalog;
  loadProductCatalog(): StoredProductCatalog;
  loadCatalogImage(id: string): { data: Buffer; ext: string; contentType: string } | null;
  renderPdf(quote: QuoteInput, deps: PdfDeps): Promise<Buffer>;
  renderXlsx(quote: QuoteInput, deps: XlsxDeps): Promise<Buffer>;
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: NO_STORE });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

function sessionCookie(request: Request): string | undefined {
  // request.headers 접근은 Cache Components의 정적화를 막는다.
  const header = request.headers.get("cookie") ?? "";
  return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}

async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) throw new RequestError(400, "입력내용을 확인하세요.");
  if (length !== null && Number(length) > MAX_REQUEST_BYTES) throw new RequestError(413, "입력내용이 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "입력내용을 확인하세요.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new RequestError(413, "입력내용이 너무 큽니다.");
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (e) {
    if (e instanceof RequestError) throw e;
    throw new RequestError(400, "입력내용을 확인하세요.");
  } finally {
    reader.releaseLock();
  }
}

async function checkOutput(bytes: Buffer, format: "pdf" | "xlsx"): Promise<boolean> {
  if (bytes.length >= MAX_RESPONSE_BYTES) return false;
  if (format === "pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  try {
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    return zip.file("xl/workbook.xml") !== null && zip.file("[Content_Types].xml") !== null;
  } catch {
    return false;
  }
}

export function createApi(deps: ApiDeps) {
  async function protectedCall(request: Request, failureMessage: string, action: () => Promise<Response> | Response) {
    try {
      if (!await verifySession(sessionCookie(request), deps.password())) return error(UNAUTHORIZED_MESSAGE, 401);
      return await action();
    } catch (e) {
      if (e instanceof RequestError) return error(e.message, e.status);
      return error(failureMessage, 500);
    }
  }

  return {
    accessCatalog: (request: Request) => protectedCall(request, "출입통제 가격표를 불러올 수 없습니다.", () => {
      const { entries, revision } = deps.loadAccessCatalog();
      return json({ entries, revision });
    }),
    catalog: (request: Request) => protectedCall(request, "제품 가격표를 불러올 수 없습니다.", () => {
      const { entries, sheets, warnings, revision } = deps.loadProductCatalog();
      return json({ entries, sheets, warnings, revision });
    }),
    staff: (request: Request) => protectedCall(request, "담당자 설정(STAFF_CONFIG)을 확인하세요.", () => json({ staff: deps.loadStaff() })),
    catalogImage: (request: Request, id: string) => protectedCall(request, "제품 사진을 불러올 수 없습니다.", () => {
      if (!/^[0-9a-f]{64}$/.test(id)) return error("제품 사진이 없습니다.", 404);
      const image = deps.loadCatalogImage(id);
      return image
        ? new Response(new Uint8Array(image.data), { headers: { ...NO_STORE, "content-type": image.contentType } })
        : error("제품 사진이 없습니다.", 404);
    }),
    generate: (request: Request) => protectedCall(request, GENERATION_ERROR, async () => {
      const raw = await readJson(request);
      // 일반 견적에도 catalog를 전달하여 직접 입력 사진 id를 서버 가격표로 제한한다.
      const validated = validateQuote(raw, deps.loadStaff(), { catalog: deps.loadProductCatalog() });
      if (!validated.ok) return error(validated.error, 400);
      const quote = validated.value;
      const format = quote.format;
      if (format !== "pdf" && format !== "xlsx") return error("파일 형식을 확인하세요.", 400);
      const imageDeps = { getImage: (id: string) => deps.loadCatalogImage(id) };
      const bytes = await (format === "pdf" ? deps.renderPdf(quote, imageDeps) : deps.renderXlsx(quote, imageDeps));
      if (!await checkOutput(bytes, format)) return error(GENERATION_ERROR, 500);
      const filename = `견적서_${safeCustomerName(quote.customer)}.${format}`;
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...NO_STORE,
          "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="quote.${format}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        },
      });
    }),
  };
}

export const api = createApi({
  password: () => process.env.APP_PASSWORD,
  loadStaff, loadAccessCatalog, loadProductCatalog, loadCatalogImage,
  renderPdf: renderQuotePdf,
  renderXlsx: renderQuoteXlsx,
});
