/**
 * 견적 입력 화면의 상태(초안)와 순수 규칙 (spec 10·11·14·15절, 기존 form.html 동작).
 * React·브라우저 API에 의존하지 않으므로 시험에서 그대로 부른다.
 * 금액 계산은 src/domain 의 함수만 쓴다. 화면 미리보기와 서버 결과가 어긋나지 않게 하기 위해서다.
 */
import {
  autoExpense,
  autoLabor,
  calculateBig,
  catalogTotals,
  categoryGroups,
  isCatalogType,
  lineAmountBig,
  QuoteRangeError,
  type AccessEntry,
  type CatalogEntry,
  type ProductCatalog,
  type QuoteType,
} from "@/domain";

/** 화면의 저장 형식. both는 PDF와 Excel 요청을 한 번호로 두 번 보낸다. */
export type SaveFormat = "pdf" | "xlsx" | "both";

/** 품목 한 줄의 화면 상태. 숫자 칸은 쉼표를 뺀 입력 문자열 그대로 둔다. */
export interface ItemRow {
  /** 화면 목록용 고유 키 (서버로 보내지 않는다) */
  key: string;
  category: string;
  name: string;
  unit: string;
  qty: string;
  priceRate: string;
  price: string;
  material: string;
  labor: string;
  expense: string;
  note: string;
  autoLabor: boolean;
  autoExpense: boolean;
  /** 제품가격표 연동 id. 비면 연동 안 된 줄 */
  catalogId: string;
  imageIds: string[];
}

/** 입력 화면 전체 상태 (브라우저 자동 저장 대상) */
export interface QuoteDraft {
  quoteType: QuoteType;
  outputFormat: SaveFormat;
  showFee: boolean;
  staffId: string;
  customer: string;
  title: string;
  contact: string;
  phone: string;
  email: string;
  date: string;
  number: string;
  numberManual: boolean;
  validity: string;
  delivery: string;
  payment: string;
  notes: string;
  blankRows: boolean;
  mergeCategories: boolean;
  items: ItemRow[];
}

export const MAX_ROWS = 100;
export const MSG_MAX_ROWS = "품목은 최대 100개입니다.";
export const DEFAULT_NOTES = "1. 해당 건에 대한 견적가격입니다.";
export const MSG_CATALOG_MISSING = "엑셀에서 제품이 삭제되거나 이름이 변경되었습니다. 다시 선택하세요.";

const QUOTE_TYPE_VALUES: readonly QuoteType[] = ["vat", "total", "cost", "catalog", "catalog2"];
const SAVE_FORMATS: readonly SaveFormat[] = ["pdf", "xlsx", "both"];

let keySeed = 0;

/**
 * 화면 목록용 줄 키를 만든다.
 * @returns {string} 이 화면 안에서 겹치지 않는 키
 */
export function newRowKey(): string {
  keySeed += 1;
  return `row-${keySeed}`;
}

/**
 * 오늘 날짜를 YYYY-MM-DD 로 만든다 (브라우저 지역 시간 기준).
 * @param {Date} now 기준 시각
 * @returns {string} 작성일 문자열
 */
export function todayText(now: Date): string {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

/**
 * 새 줄을 만든다. 기본값은 단위 '식', 수량 1, 적용률 100, 비용 0, 자동 노무비·경비 켜짐이다.
 * @param {Partial<ItemRow>} values 덮어쓸 값
 * @returns {ItemRow} 새 줄
 */
export function newRow(values: Partial<ItemRow> = {}): ItemRow {
  const row: ItemRow = {
    key: newRowKey(),
    category: "",
    name: "",
    unit: "식",
    qty: "1",
    priceRate: "100",
    price: "",
    material: "0",
    labor: "0",
    expense: "0",
    note: "",
    autoLabor: true,
    autoExpense: true,
    catalogId: "",
    imageIds: [],
    ...values,
  };
  return applyAutoCosts(row);
}

/**
 * 새 초안을 만든다 (spec 15절 기본값).
 * @param {string} date 작성일
 * @param {string} staffId 처음 선택할 담당자 id
 * @returns {QuoteDraft} 기본 초안
 */
export function newDraft(date: string, staffId: string): QuoteDraft {
  return {
    quoteType: "vat",
    outputFormat: "pdf",
    showFee: true,
    staffId,
    customer: "",
    title: "",
    contact: "",
    phone: "",
    email: "",
    date,
    number: "",
    numberManual: false,
    validity: "발행일로부터 30일",
    delivery: "협의",
    payment: "고객사와 협의",
    notes: DEFAULT_NOTES,
    blankRows: true,
    mergeCategories: true,
    items: [newRow()],
  };
}

/**
 * 금액 칸 값에서 쉼표를 지운다.
 * @param {string} value 입력값
 * @returns {string} 쉼표를 뺀 값
 */
export function rawMoney(value: string): string {
  return value.replace(/,/g, "");
}

/**
 * 숫자만 있는 값에 천 단위 쉼표를 붙인다. 숫자가 아니면 그대로 둔다.
 * @param {string} raw 쉼표 없는 값
 * @returns {string} 표시용 값
 */
export function groupDigits(raw: string): string {
  return /^\d+$/.test(raw) ? raw.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : raw;
}

/**
 * 입력 중인 금액 칸에 쉼표를 붙이고, 커서 오른쪽 숫자 개수를 유지하도록 커서 위치를 다시 계산한다 (기존 formatPrice).
 * @param {string} typed 사용자가 입력한 직후의 칸 값
 * @param {number} caret 입력 직후 커서 위치
 * @returns {{raw: string, display: string, caret: number}} 저장할 값, 표시 값, 새 커서 위치
 */
export function formatMoneyTyping(typed: string, caret: number): { raw: string; display: string; caret: number } {
  const raw = rawMoney(typed);
  if (!/^\d+$/.test(raw)) return { raw, display: typed, caret };
  const display = groupDigits(raw);
  let right = rawMoney(typed.slice(caret)).length;
  let pos = display.length;
  while (pos > 0 && right > 0) {
    pos -= 1;
    if (display[pos] !== ",") right -= 1;
  }
  return { raw, display, caret: pos };
}

/**
 * ③ 자동 노무비·경비 상태가 켜진 칸을 다시 계산한다. 재료비·노무비가 정수가 아니면 빈칸으로 둔다 (기존 ratio).
 * @param {ItemRow} row 줄
 * @returns {ItemRow} 계산이 반영된 줄
 */
export function applyAutoCosts(row: ItemRow): ItemRow {
  const next = { ...row };
  if (next.autoLabor) next.labor = /^\d+$/.test(next.material) ? String(autoLabor(next.material)) : "";
  if (next.autoExpense) next.expense = /^\d+$/.test(next.labor) ? String(autoExpense(next.labor)) : "";
  return next;
}

/**
 * 줄의 한 칸을 고친다. 노무비·경비를 직접 고치면 그 자동 상태를 끄고, 자동 비용을 다시 계산한다.
 * @param {ItemRow} row 줄
 * @param {EditableField} field 고친 칸
 * @param {string} value 새 값
 * @returns {ItemRow} 바뀐 줄
 */
export function editRow(row: ItemRow, field: EditableField, value: string): ItemRow {
  const next: ItemRow = { ...row, [field]: value };
  if (field === "labor") next.autoLabor = false;
  if (field === "expense") next.autoExpense = false;
  return applyAutoCosts(next);
}

/** 화면에서 직접 고치는 칸 */
export type EditableField = "category" | "name" | "unit" | "qty" | "priceRate" | "price" | "material" | "labor" | "expense" | "note";

/**
 * '자동으로 복원'을 눌렀을 때 자동 상태를 다시 켜고 즉시 계산한다.
 * @param {ItemRow} row 줄
 * @param {"labor" | "expense"} which 복원할 비용
 * @returns {ItemRow} 바뀐 줄
 */
export function restoreAuto(row: ItemRow, which: "labor" | "expense"): ItemRow {
  return applyAutoCosts({ ...row, [which === "labor" ? "autoLabor" : "autoExpense"]: true });
}

/**
 * 빈 줄 하나만 있는지 (가격표에서 처음 추가할 때 그 줄을 대체한다).
 * @param {ItemRow[]} items 줄 목록
 * @returns {boolean} 빈 줄 하나뿐이면 true
 */
export function onlyBlankRow(items: readonly ItemRow[]): boolean {
  return items.length === 1 && !items[0].name.trim();
}

/** 줄 추가 결과. error가 있으면 줄을 바꾸지 않았다. */
export type AddResult = { draft: QuoteDraft; error?: string };

/**
 * 출입통제 가격표 항목을 새 줄로 추가한다 (spec 10절, 기존 accessAdd).
 * 구분 = 품목 종류, 품목명 = 모델명(없으면 품목 종류). ③은 비용 성격에 따라 재료비나 노무비에 넣고 자동 상태를 끈다.
 * @param {QuoteDraft} draft 초안
 * @param {AccessEntry} entry 가격표 항목
 * @returns {AddResult} 바뀐 초안 또는 오류
 */
export function addAccessEntry(draft: QuoteDraft, entry: AccessEntry): AddResult {
  if (isCatalogType(draft.quoteType)) return { draft };
  const base = onlyBlankRow(draft.items) ? [] : draft.items;
  if (base.length >= MAX_ROWS) return { draft, error: MSG_MAX_ROWS };
  const row = newRow({
    category: entry.title,
    name: entry.model || entry.title,
    unit: entry.unit,
    qty: String(entry.qty),
    priceRate: "100",
    price: String(entry.price),
    note: entry.note,
    material: entry.costBucket === "material" ? String(entry.price) : "0",
    labor: entry.costBucket === "labor" ? String(entry.price) : "0",
    expense: "0",
    autoLabor: false,
    autoExpense: false,
  });
  return { draft: { ...draft, items: [...base, row] } };
}

/**
 * 제품 수수료 문구를 참고사항용으로 바꾼다. 조달수수료는 항상 '별도'로 적는다.
 * @param {string} fee 시트의 수수료 문구
 * @returns {string} 바꾼 문구
 */
export function feeNote(fee: string): string {
  return fee.replace(/조달수수료\s*\(0\.54%\)\s*(총계 포함|합계 포함|포함|별도)/, "조달수수료(0.54%) 별도");
}

/**
 * 제품가격표 항목을 연동 줄로 추가한다 (spec 11절, 기존 catalogAdd).
 * 빈 줄 하나뿐인 상태에서 첫 제품이면 그 시트의 조건·제목·참고사항을 채운다.
 * @param {QuoteDraft} draft 초안
 * @param {CatalogEntry} entry 가격표 항목
 * @returns {AddResult} 바뀐 초안 또는 오류
 */
export function addCatalogEntry(draft: QuoteDraft, entry: CatalogEntry): AddResult {
  const first = onlyBlankRow(draft.items);
  const base = first ? [] : draft.items;
  if (base.length >= MAX_ROWS) return { draft, error: MSG_MAX_ROWS };
  const row = newRow({
    category: entry.category,
    name: entry.name,
    unit: entry.unit,
    qty: entry.qty,
    price: entry.price === null ? "" : String(entry.price),
    note: entry.note,
    catalogId: entry.id,
    imageIds: [...entry.imageIds],
  });
  const next: QuoteDraft = { ...draft, items: [...base, row] };
  if (first) {
    next.validity = entry.terms.validity;
    next.delivery = entry.terms.delivery;
    next.payment = entry.terms.payment;
    if (!next.title) next.title = entry.title;
    const notes = ["해당 건에 대한 견적가격입니다.", ...entry.terms.notes.map((n) => n.replace(/^\d+\.\s*/, ""))];
    if (entry.terms.fee) notes.push(feeNote(entry.terms.fee));
    next.notes = notes.map((n, i) => `${i + 1}. ${n}`).join("\n");
  }
  return { draft: next };
}

/**
 * 줄을 바로 아래에 복제한다 (연동 상태 포함).
 * @param {QuoteDraft} draft 초안
 * @param {string} key 복제할 줄 키
 * @returns {AddResult} 바뀐 초안 또는 오류
 */
export function duplicateRow(draft: QuoteDraft, key: string): AddResult {
  if (draft.items.length >= MAX_ROWS) return { draft, error: MSG_MAX_ROWS };
  const index = draft.items.findIndex((r) => r.key === key);
  if (index < 0) return { draft };
  const copy = { ...draft.items[index], key: newRowKey(), imageIds: [...draft.items[index].imageIds] };
  const items = [...draft.items];
  items.splice(index + 1, 0, copy);
  return { draft: { ...draft, items } };
}

/**
 * 줄을 지운다. 마지막 줄을 지우면 빈 줄 하나를 남긴다.
 * @param {QuoteDraft} draft 초안
 * @param {string} key 지울 줄 키
 * @returns {QuoteDraft} 바뀐 초안
 */
export function removeRow(draft: QuoteDraft, key: string): QuoteDraft {
  const items = draft.items.filter((r) => r.key !== key);
  return { ...draft, items: items.length ? items : [newRow()] };
}

const LINK_FIELDS = [
  ["name", "품목명"],
  ["category", "구분"],
  ["unit", "단위"],
  ["note", "비고"],
  ["price", "단가"],
] as const;

/**
 * 연동 줄을 현재 제품가격표 값으로 맞춘다 (spec 11절 '가격표 변경 반영').
 * 수량과 적용률은 유지한다. 가격표에서 사라진 제품의 줄은 그대로 두고 missing으로 알린다.
 * @param {QuoteDraft} draft 초안
 * @param {ProductCatalog} catalog 현재 제품가격표
 * @returns {{draft: QuoteDraft, changes: string[], missing: number[]}} 바뀐 초안, 바뀐 줄 설명("1번(단가·사진)"), 사라진 제품 줄 번호
 */
export function syncLinkedRows(draft: QuoteDraft, catalog: ProductCatalog): { draft: QuoteDraft; changes: string[]; missing: number[] } {
  if (!isCatalogType(draft.quoteType)) return { draft, changes: [], missing: [] };
  const byId = new Map(catalog.entries.map((e) => [e.id, e]));
  const changes: string[] = [];
  const missing: number[] = [];
  let touched = false;
  const items = draft.items.map((row, i) => {
    if (!row.catalogId) return row;
    const entry = byId.get(row.catalogId);
    if (!entry) {
      missing.push(i + 1);
      return row;
    }
    const next = { ...row };
    const labels: string[] = [];
    for (const [field, label] of LINK_FIELDS) {
      if (field === "price" && entry.price === null) continue;
      const value = field === "price" ? String(entry.price) : entry[field];
      if (next[field] !== value) {
        next[field] = value;
        labels.push(label);
      }
    }
    if (next.imageIds.join("\n") !== entry.imageIds.join("\n")) {
      next.imageIds = [...entry.imageIds];
      labels.push("사진");
    }
    if (!labels.length) return row;
    touched = true;
    changes.push(`${i + 1}번(${labels.join("·")})`);
    return next;
  });
  return { draft: touched ? { ...draft, items } : draft, changes, missing };
}

/**
 * 가격표 변경 알림 문구를 만든다.
 * @param {string[]} changes syncLinkedRows의 바뀐 줄 설명
 * @returns {string} 알림 문구 (바뀐 줄이 없으면 빈 문자열)
 */
export function changeNotice(changes: readonly string[]): string {
  return changes.length ? `가격표가 바뀌어 다음 품목이 갱신되었습니다: ${changes.join(", ")}` : "";
}

/**
 * 연동을 해제한다. 이후 그 줄은 가격표를 따르지 않는다.
 * @param {QuoteDraft} draft 초안
 * @param {string} key 줄 키
 * @returns {QuoteDraft} 바뀐 초안
 */
export function detachRow(draft: QuoteDraft, key: string): QuoteDraft {
  return { ...draft, items: draft.items.map((r) => (r.key === key ? { ...r, catalogId: "" } : r)) };
}

/** 하단 합계 표시 값 */
export interface DraftTotals {
  /** 줄 금액 (입력이 올바르지 않은 줄은 0) */
  lines: bigint[];
  /** 묶음 순번 */
  groups: number[];
  subtotal: bigint;
  tax: bigint;
  /** ④⑤ 할인 후 금액 */
  discounted: bigint;
  /** ④⑤ 조달수수료 (견적가에 더하지 않는다) */
  fee: bigint;
  total: bigint;
  /** 견적 합계 범위 초과 등 계산 오류 문구 */
  error: string;
}

/**
 * 계산용 줄 값. 입력이 올바르지 않은 줄은 0원으로 친다 (기존 화면과 같다).
 * @param {ItemRow} row 줄
 * @param {QuoteType} type 견적서 종류
 * @returns {{qty: string, price: string, priceRate: string, material: string, labor: string, expense: string}} 계산에 쓸 값
 */
function calcItem(row: ItemRow, type: QuoteType) {
  // ③의 비용 칸은 숫자가 아닌 칸만 0으로 친다 (기존 totals와 같다).
  const cost = (m: string) => (/^\d+$/.test(m) ? m : "0");
  const valid =
    /^\d+(\.\d{1,3})?$/.test(row.qty) &&
    /^\d+(\.\d{1,2})?$/.test(row.priceRate) &&
    Number(row.priceRate) <= 100 &&
    (type === "cost" || /^\d+$/.test(row.price));
  if (!valid) return { qty: "0", price: "0", priceRate: "100", material: "0", labor: "0", expense: "0" };
  return { qty: row.qty, price: type === "cost" ? "0" : row.price, priceRate: row.priceRate, material: cost(row.material), labor: cost(row.labor), expense: cost(row.expense) };
}

/**
 * 하단 합계와 줄 금액을 계산한다. 규칙은 서버와 같은 src/domain 계산을 쓴다.
 * @param {QuoteDraft} draft 초안
 * @returns {DraftTotals} 표시 값
 */
export function draftTotals(draft: QuoteDraft): DraftTotals {
  const items = draft.items.map((r) => calcItem(r, draft.quoteType));
  const lines = items.map((it) => lineAmountBig(it, draft.quoteType));
  const groups = categoryGroups(draft.items, draft.mergeCategories);
  let subtotal = lines.reduce((a, b) => a + b, BigInt(0));
  let tax = BigInt(0);
  let total = subtotal;
  let error = "";
  try {
    const r = calculateBig(items, draft.quoteType);
    subtotal = r.subtotal;
    tax = r.tax;
    total = r.total;
  } catch (e) {
    if (!(e instanceof QuoteRangeError)) throw e;
    error = e.message;
  }
  let discounted = subtotal;
  let fee = BigInt(0);
  // 범위를 넘으면 수수료를 계산하지 않는다 (숫자 변환 정밀도 손실 방지).
  if (isCatalogType(draft.quoteType) && !error) {
    const c = catalogTotals(subtotal);
    discounted = BigInt(c.discounted);
    fee = BigInt(c.fee);
  }
  return { lines, groups, subtotal, tax, discounted, fee, total, error };
}

/**
 * 생성 요청 본문을 만든다 (spec 8절 표의 필드만).
 * @param {QuoteDraft} draft 초안
 * @param {"pdf" | "xlsx"} format 이번 요청의 파일 형식
 * @param {string} number 확정한 견적번호
 * @param {string} staffPhone 화면의 현재 담당자 휴대폰
 * @param {string} catalogRevision ④⑤ 가격표 revision
 * @returns {Record<string, unknown>} 요청 본문
 */
export function toGenerateRequest(
  draft: QuoteDraft,
  format: "pdf" | "xlsx",
  number: string,
  staffPhone: string,
  catalogRevision: string,
): Record<string, unknown> {
  const catalog = isCatalogType(draft.quoteType);
  return {
    format,
    quoteType: draft.quoteType,
    customer: draft.customer,
    contact: draft.contact,
    phone: draft.phone,
    email: draft.email,
    title: draft.title,
    validity: draft.validity,
    delivery: draft.delivery,
    payment: draft.payment,
    date: draft.date,
    number,
    staffId: draft.staffId,
    staffPhone,
    notes: draft.notes,
    showFee: draft.showFee,
    mergeCategories: draft.mergeCategories,
    blankRows: draft.blankRows,
    ...(catalog ? { catalogRevision } : {}),
    items: draft.items.map((r) => ({
      category: r.category,
      name: r.name,
      unit: r.unit,
      qty: r.qty,
      price: r.price,
      priceRate: r.priceRate,
      material: r.material,
      labor: r.labor,
      expense: r.expense,
      note: r.note,
      catalogId: catalog ? r.catalogId : "",
      imageIds: catalog ? r.imageIds : [],
    })),
  };
}

/**
 * 저장소에서 읽은 값을 초안 모양으로 고친다. 모양이 크게 다르면 null.
 * @param {unknown} value 저장소 값
 * @param {QuoteDraft} fallback 빠진 칸을 채울 기본 초안
 * @returns {QuoteDraft | null} 초안
 */
export function normalizeDraft(value: unknown, fallback: QuoteDraft): QuoteDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.items)) return null;
  const str = (x: unknown, d: string) => (typeof x === "string" ? x : d);
  const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
  const items = v.items
    .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
    .slice(0, MAX_ROWS)
    .map((it) =>
      newRow({
        category: str(it.category, ""),
        name: str(it.name, ""),
        unit: str(it.unit, "식"),
        qty: str(it.qty, "1"),
        priceRate: str(it.priceRate, "100"),
        price: str(it.price, ""),
        material: str(it.material, "0"),
        labor: str(it.labor, "0"),
        expense: str(it.expense, "0"),
        note: str(it.note, ""),
        autoLabor: bool(it.autoLabor, true),
        autoExpense: bool(it.autoExpense, true),
        catalogId: str(it.catalogId, ""),
        imageIds: Array.isArray(it.imageIds) ? it.imageIds.filter((x): x is string => typeof x === "string") : [],
      }),
    );
  return {
    quoteType: QUOTE_TYPE_VALUES.includes(v.quoteType as QuoteType) ? (v.quoteType as QuoteType) : fallback.quoteType,
    outputFormat: SAVE_FORMATS.includes(v.outputFormat as SaveFormat) ? (v.outputFormat as SaveFormat) : fallback.outputFormat,
    showFee: bool(v.showFee, true),
    staffId: str(v.staffId, fallback.staffId),
    customer: str(v.customer, ""),
    title: str(v.title, ""),
    contact: str(v.contact, ""),
    phone: str(v.phone, ""),
    email: str(v.email, ""),
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(v.date, "")) ? (v.date as string) : fallback.date,
    number: str(v.number, ""),
    numberManual: v.numberManual === true,
    validity: str(v.validity, fallback.validity),
    delivery: str(v.delivery, fallback.delivery),
    payment: str(v.payment, fallback.payment),
    notes: str(v.notes, "").trim() ? (v.notes as string) : DEFAULT_NOTES,
    blankRows: bool(v.blankRows, true),
    mergeCategories: bool(v.mergeCategories, true),
    items: items.length ? items : [newRow()],
  };
}

/**
 * 견적서 종류별 안내 문구 (기존 화면 문구 그대로).
 * @param {QuoteType} type 견적서 종류
 * @returns {string} 안내 문구
 */
export function typeHelp(type: QuoteType): string {
  if (isCatalogType(type)) {
    return "엑셀의 부가세 포함 단가를 그대로 사용합니다. 부가세를 추가하지 않습니다. 품목 합계 5천만원 이상은 2% 할인하고, 조달수수료 0.54%는 별도이며 합계에 더하지 않습니다. 원 미만은 반올림합니다. PDF에는 할인을 반영한 최종 합계만 노란색 한 줄로 표시합니다.";
  }
  if (type === "vat") return "단가는 부가세 별도 금액입니다. 합계에 부가세 10%를 더하고 PDF에 별도 표시합니다.";
  if (type === "total") return "단가는 부가세 미포함 금액입니다. 부가세를 더하지 않고 공급가액만 표시합니다.";
  return "재료비·노무비·경비는 각각 수량 1개당 부가세 별도 금액입니다. (재료비 + 노무비 + 경비) × 수량을 합산한 뒤 부가세 10%를 더합니다. 노무비는 재료비 × 281.25%, 경비는 노무비 × 3%로 자동 입력됩니다(원 단위 반올림). 직접 수정한 칸은 유지되며 자동으로 복원할 수 있습니다.";
}
