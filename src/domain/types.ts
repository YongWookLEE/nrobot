/**
 * 화면·서버 공용 도메인 타입.
 * 다른 작업이 이 이름들을 가져다 쓰므로 이름을 바꾸지 않는다.
 */

/** 견적서 종류: ① 부가세 표시, ② 부가세 미포함, ③ 비용 분리, ④⑤ 제품 견적 */
export type QuoteType = "vat" | "total" | "cost" | "catalog" | "catalog2";

export const QUOTE_TYPES: readonly QuoteType[] = ["vat", "total", "cost", "catalog", "catalog2"];

/** 요청 1회에 만드는 파일 형식 */
export type OutputFormat = "pdf" | "xlsx";

export const OUTPUT_FORMATS: readonly OutputFormat[] = ["pdf", "xlsx"];

/** ④⑤ 종류인지 */
export function isCatalogType(type: QuoteType): boolean {
  return type === "catalog" || type === "catalog2";
}

/** 담당자 (STAFF_CONFIG 한 항목) */
export interface Staff {
  id: string;
  name: string;
  title: string;
  phone: string;
  start: number;
}

/** 표시 이름이 붙은 담당자. display = 이름 + ' ' + 직급 (직급이 비면 이름만) */
export type StaffProfile = Staff & { display: string };

/** 셀 서식 */
export interface CellStyle {
  font: string;
  size: number;
  bold: boolean;
  color: string;
  fill: string;
  align: string;
}

/** 제품가격표 한 항목의 출력 서식 */
export interface CatalogTemplate {
  columns: number[];
  height: number;
  lines: Array<CellStyle & { text: string; height: number }>;
  cells: Record<"A" | "B" | "F" | "G" | "H" | "I" | "J", CellStyle>;
  header: CellStyle;
  headerHeight: number;
  imageSizes: Record<string, [number, number]>;
}

/** 검증·정규화된 품목 */
export interface QuoteItem {
  category: string;
  name: string;
  unit: string;
  note: string;
  qty: number;
  price: number;
  priceRate: number;
  material?: number;
  labor?: number;
  expense?: number;
  catalogId?: string;
  imageIds?: string[];
  model?: string;
  template?: CatalogTemplate;
}

/** 검증·정규화된 견적 */
export interface QuoteInput {
  quoteType: QuoteType;
  customer: string;
  contact: string;
  phone: string;
  email: string;
  title: string;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  /** "견적 유효기간 : " 접두어가 붙은 값 */
  validity: string;
  /** "납품 : " 접두어가 붙은 값 */
  delivery: string;
  /** "결제 : " 접두어가 붙은 값 */
  payment: string;
  staffId: string;
  staffDisplay: string;
  staffPhone: string;
  notes: string;
  showFee: boolean;
  mergeCategories: boolean;
  blankRows: boolean;
  catalogRevision?: string;
  items: QuoteItem[];
}

/** 생성 요청 품목 (가공 전) */
export interface GenerateRequestItem {
  category?: unknown;
  name?: unknown;
  unit?: unknown;
  qty?: unknown;
  price?: unknown;
  priceRate?: unknown;
  material?: unknown;
  labor?: unknown;
  expense?: unknown;
  note?: unknown;
  catalogId?: unknown;
  imageIds?: unknown;
  [key: string]: unknown;
}

/** POST /api/generate 요청 본문 (가공 전) */
export interface GenerateRequest {
  format?: unknown;
  quoteType?: unknown;
  customer?: unknown;
  contact?: unknown;
  phone?: unknown;
  email?: unknown;
  title?: unknown;
  validity?: unknown;
  delivery?: unknown;
  payment?: unknown;
  date?: unknown;
  number?: unknown;
  staffId?: unknown;
  staffPhone?: unknown;
  notes?: unknown;
  showFee?: unknown;
  mergeCategories?: unknown;
  blankRows?: unknown;
  catalogRevision?: unknown;
  items?: unknown;
  [key: string]: unknown;
}

/** 출입통제 기준가격표 한 항목 */
export interface AccessEntry {
  id: string;
  title: string;
  model: string;
  category: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
  note: string;
  costBucket: "material" | "labor";
}

export interface AccessCatalog {
  entries: AccessEntry[];
  revision: string;
}

/** 영업팀 제품가격표 한 항목 */
export interface CatalogEntry {
  id: string;
  sheet: string;
  row: number;
  end: number;
  model: string;
  code: string;
  title: string;
  category: string;
  name: string;
  unit: string;
  qty: string;
  price: number | null;
  note: string;
  internalNote: string;
  imageIds: string[];
  terms: { validity: string; delivery: string; payment: string; notes: string[]; fee: string };
  template: CatalogTemplate;
}

export interface ProductCatalog {
  entries: CatalogEntry[];
  sheets: Array<{ name: string; count: number }>;
  warnings: string[];
  revision: string;
}

/** 계산 결과 */
export interface QuoteTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/** 조달수수료 계산 결과 (수수료는 견적가에 더하지 않는다) */
export interface CatalogTotals {
  discounted: number;
  fee: number;
  withFee: number;
}
