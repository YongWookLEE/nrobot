// PDF 시험 도우미: 골든 입력(render_inputs.json) → 검증된 견적(QuoteInput), 비교용 PDF 저장.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateQuote } from "@/domain/validate";
import { isCatalogType, type ProductCatalog, type QuoteInput, type QuoteType, type Staff } from "@/domain/types";
import { parseProductCatalog } from "@/pricelists/catalog";
import { renderQuotePdfWithInfo, type PdfImage } from "@/output/pdf";

const root = process.cwd();

/** 가짜 담당자 (골든 생성기와 같은 구조) */
export const FAKE_STAFF: Staff[] = [
  { id: "a", name: "홍길동", title: "차장", phone: "010-0000-0001", start: 1 },
  { id: "b", name: "김철수", title: "차장", phone: "010-0000-0002", start: 10 },
  { id: "c", name: "이영희", title: "대리", phone: "010-0000-0003", start: 20 },
];

export interface RenderInput {
  name: string;
  legacyInput: Record<string, unknown>;
  input: Record<string, unknown>;
}

export function loadRenderInputs(): RenderInput[] {
  return JSON.parse(readFileSync(path.join(root, "tests/golden/render_inputs.json"), "utf8")) as RenderInput[];
}

export interface FixtureCatalog {
  catalog: ProductCatalog;
  getImage(id: string): PdfImage | null;
}

let fixture: Promise<FixtureCatalog> | null = null;

/** 시험용 합성 제품가격표 (tests/fixtures/catalog.xlsx) */
export function loadFixtureCatalog(): Promise<FixtureCatalog> {
  fixture ??= parseProductCatalog(readFileSync(path.join(root, "tests/fixtures/catalog.xlsx"))).then(({ catalog, images }) => ({
    catalog,
    getImage: (id: string) => images.get(id) ?? null,
  }));
  return fixture;
}

/** 요청 형태 입력을 검증해 QuoteInput 으로 바꾼다. ④⑤는 합성 가격표로 연동한다(catalogId 기준, 사진 id 는 가격표 값). */
export async function toQuoteInput(input: Record<string, unknown>): Promise<QuoteInput> {
  const type = input.quoteType as QuoteType;
  let options = {};
  let raw = input;
  if (isCatalogType(type)) {
    const { catalog } = await loadFixtureCatalog();
    raw = { ...input, catalogRevision: catalog.revision };
    options = { catalog };
  }
  const result = validateQuote(raw, FAKE_STAFF, options);
  if (!result.ok) throw new Error(`검증 실패: ${result.error}`);
  return result.value;
}

export function hasPrivate(): boolean {
  return existsSync(path.join(root, "private"));
}

export interface LegacyResult {
  name: string;
  pages: number;
  total: number;
}

export function legacyResults(): LegacyResult[] | null {
  const p = path.join(root, "private/compare/legacy/results.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as LegacyResult[]) : null;
}

export function legacyPdfPath(name: string): string {
  return path.join(root, "private/compare/legacy", `${name}.pdf`);
}

/**
 * 골든 입력 전부를 private/compare/new/{name}.pdf 로 그린다 (private 가 있을 때만, 눈으로 비교하는 용도).
 * 맑은 고딕이 없으면 ①②③은 건너뛴다. 돌려주는 값: 이름별 페이지 수.
 */
export async function renderAllForCompare(skipMalgun: boolean): Promise<Array<{ name: string; pages: number; total: number; scale: number }>> {
  const out: Array<{ name: string; pages: number; total: number; scale: number }> = [];
  if (!hasPrivate()) return out;
  const dir = path.join(root, "private/compare/new");
  mkdirSync(dir, { recursive: true });
  const { getImage } = await loadFixtureCatalog();
  for (const { name, input } of loadRenderInputs()) {
    if (skipMalgun && !isCatalogType(input.quoteType as QuoteType)) continue;
    const quote = await toQuoteInput(input);
    const result = await renderQuotePdfWithInfo(quote, { getImage });
    writeFileSync(path.join(dir, `${name}.pdf`), result.buffer);
    out.push({ name, pages: result.pages, total: result.total, scale: result.scale });
  }
  return out;
}
