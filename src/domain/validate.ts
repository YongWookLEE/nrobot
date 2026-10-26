/**
 * 생성 요청 검증·정규화 (spec 8절 — 기존 validation.py 규칙과 문구 그대로).
 * 첫 번째로 걸린 규칙의 메시지를 돌려준다.
 */
import { calculate, QuoteRangeError } from "./calculate";
import { B0, parseDecimal, pow10, scaledToNumber, toScaled, type Decimal } from "./money";
import {
  isCatalogType,
  OUTPUT_FORMATS,
  QUOTE_TYPES,
  type OutputFormat,
  type ProductCatalog,
  type QuoteInput,
  type QuoteItem,
  type QuoteType,
  type Staff,
  type StaffProfile,
} from "./types";

export type ValidationResult = { ok: true; value: QuoteInput } | { ok: false; error: string };

export interface ValidateOptions {
  /** ④⑤ 가격표. 주면 catalogRevision 확인과 연동 행 덮어쓰기를 한다. */
  catalog?: ProductCatalog;
  /** 직접 입력 행의 사진 id가 실제로 있는지. 주지 않으면 문자열 id를 그대로 둔다. */
  imageExists?: (id: string) => boolean;
}

export const MESSAGES = {
  format: "저장 형식을 선택하세요.",
  quoteType: "견적서 종류를 선택하세요.",
  text: "입력 문구가 너무 길거나 올바르지 않습니다.",
  required: "거래처와 견적 제목을 입력하세요.",
  date: "작성일을 YYYY-MM-DD 형식으로 입력하세요.",
  staff: "작성자를 선택하세요.",
  staffPhone: "담당자 휴대폰번호는 30자 이내로 입력하세요.",
  number: "견적번호는 1~100자로 입력하세요.",
  itemCount: "품목은 1~100개로 입력하세요.",
  notes: "참고사항을 확인하세요.",
  catalogRevision: "제품 엑셀이 변경되었습니다. 최신 내용을 불러온 후 다시 만들어주세요.",
  generic: "품목과 금액 입력을 확인하세요.",
  itemText: (i: number) => `${i}번 품목의 문구를 확인하세요.`,
  itemRequired: (i: number) => `${i}번 품목명과 단위를 입력하세요.`,
  itemMissingNumber: (i: number) => `${i}번 수량과 단가를 입력하세요.`,
  itemNumber: (i: number) => `${i}번 수량은 양수(소수 셋째 자리까지), 단가는 0 이상의 정수로 입력하세요.`,
  itemMissingRate: (i: number) => `${i}번 적용률을 입력하세요.`,
  itemRate: (i: number) => `${i}번 적용률은 0~100%, 소수 둘째 자리까지 입력하세요.`,
  itemMissingCost: (i: number) => `${i}번 재료비·노무비·경비를 모두 입력하세요. 없는 비용은 0으로 입력하세요.`,
  itemCost: (i: number) => `${i}번 비용은 0 이상의 원 단위 정수로 입력하세요.`,
  itemCatalogMissing: (i: number) => `${i}번 제품이 엑셀에서 삭제되거나 이름이 변경되었습니다. 다시 선택하세요.`,
} as const;

const TEXT_LIMIT = 500;
const CATALOG_ITEM_TEXT_LIMIT = 10_000;
const NOTES_LIMIT = 2000;
const STAFF_PHONE_LIMIT = 30;
const MAX_ITEMS = 100;
const MAX_QTY = pow10(6) * pow10(3); // 1,000,000 (소수 3자리 스케일)
const MAX_MONEY = pow10(11); // 100,000,000,000
const MAX_RATE = BigInt(100) * pow10(2); // 100 (소수 2자리 스케일)

const PREFIX = { validity: "견적 유효기간 : ", delivery: "납품 : ", payment: "결제 : " } as const;

class ValidationError extends Error {}

function fail(message: string): never {
  throw new ValidationError(message);
}

/** 문자 수 (파이썬 len과 같은 코드 포인트 기준) */
function charCount(s: string): number {
  return Array.from(s).length;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 없는 값은 빈 문자열. 문자열이 아니거나 길면 message. 앞뒤 공백 제거. */
function text(value: unknown, limit: number, message: string): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || charCount(value) > limit) fail(message);
  return value.trim();
}

/** 기존 `is True`와 같다: 리터럴 true만 참, 값이 없으면 기본값 참 */
function flag(value: unknown): boolean {
  return value === undefined ? true : value === true;
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) < 32) return true;
  return false;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/** 0 이상 MAX_MONEY 이하의 원 단위 정수인지. 아니면 null. */
function wholeWon(d: Decimal | null): bigint | null {
  const v = d ? toScaled(d, 0) : null;
  if (v === null || v < B0 || v > MAX_MONEY) return null;
  return v;
}

/** 담당자 표시 이름: 이름 + ' ' + 직급 (직급이 비면 이름만) */
export function staffProfile(staff: Staff): StaffProfile {
  const title = staff.title.trim();
  return { ...staff, display: title ? `${staff.name} ${title}` : staff.name };
}

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

function validateItem(
  raw: unknown,
  i: number,
  quoteType: QuoteType,
  options: ValidateOptions,
): QuoteItem {
  if (!isRecord(raw)) fail(MESSAGES.generic);
  const catalogType = isCatalogType(quoteType);
  const limit = catalogType ? CATALOG_ITEM_TEXT_LIMIT : TEXT_LIMIT;
  const category = text(raw.category, limit, MESSAGES.itemText(i));
  const name = text(raw.name, limit, MESSAGES.itemText(i));
  const unit = text(raw.unit, limit, MESSAGES.itemText(i));
  const note = text(raw.note, limit, MESSAGES.itemText(i));
  if (!name || !unit) fail(MESSAGES.itemRequired(i));

  const isCost = quoteType === "cost";
  const qtyDec = parseDecimal(raw.qty);
  const priceDec = isCost ? null : parseDecimal(raw.price);
  if (!qtyDec || (!isCost && !priceDec)) fail(MESSAGES.itemMissingNumber(i));
  const qty = toScaled(qtyDec, 3);
  if (qty === null || qty <= B0 || qty > MAX_QTY) fail(MESSAGES.itemNumber(i));
  let price = B0;
  if (!isCost) {
    const p = wholeWon(priceDec);
    if (p === null) fail(MESSAGES.itemNumber(i));
    price = p;
  }

  let rate = MAX_RATE;
  if (raw.priceRate !== undefined) {
    const rateDec = parseDecimal(raw.priceRate);
    if (!rateDec) fail(MESSAGES.itemMissingRate(i));
    const r = toScaled(rateDec, 2);
    if (r === null || r < B0 || r > MAX_RATE) fail(MESSAGES.itemRate(i));
    rate = r;
  }

  const item: QuoteItem = {
    category,
    name,
    unit,
    note,
    qty: scaledToNumber(qty, 3),
    price: Number(price),
    priceRate: scaledToNumber(rate, 2),
  };

  if (isCost) {
    if (isBlank(raw.material) || isBlank(raw.labor) || isBlank(raw.expense)) fail(MESSAGES.itemMissingCost(i));
    const material = wholeWon(parseDecimal(raw.material));
    const labor = wholeWon(parseDecimal(raw.labor));
    const expense = wholeWon(parseDecimal(raw.expense));
    if (material === null || labor === null || expense === null) fail(MESSAGES.itemCost(i));
    item.material = Number(material);
    item.labor = Number(labor);
    item.expense = Number(expense);
  }

  if (catalogType) {
    const catalogId = typeof raw.catalogId === "string" ? raw.catalogId.trim() : "";
    const ids = stringIds(raw.imageIds);
    if (catalogId && options.catalog) {
      const entry = options.catalog.entries.find((e) => e.id === catalogId);
      if (!entry) fail(MESSAGES.itemCatalogMissing(i));
      item.name = entry.name;
      item.category = entry.category;
      item.unit = entry.unit;
      item.note = entry.note;
      if (entry.price !== null) item.price = entry.price;
      item.template = entry.template;
      item.catalogId = entry.id;
      item.imageIds = [...entry.imageIds];
      item.model = entry.model;
    } else {
      if (catalogId) item.catalogId = catalogId;
      item.imageIds = options.imageExists ? ids.filter((id) => options.imageExists!(id)) : ids;
    }
  }
  return item;
}

function run(raw: unknown, staffList: readonly Staff[], options: ValidateOptions): QuoteInput {
  if (!isRecord(raw)) fail(MESSAGES.generic);

  if (!OUTPUT_FORMATS.includes(raw.format as OutputFormat)) fail(MESSAGES.format);
  if (!QUOTE_TYPES.includes(raw.quoteType as QuoteType)) fail(MESSAGES.quoteType);
  const quoteType = raw.quoteType as QuoteType;

  const customer = text(raw.customer, TEXT_LIMIT, MESSAGES.text);
  const contact = text(raw.contact, TEXT_LIMIT, MESSAGES.text);
  const phone = text(raw.phone, TEXT_LIMIT, MESSAGES.text);
  const email = text(raw.email, TEXT_LIMIT, MESSAGES.text);
  const title = text(raw.title, TEXT_LIMIT, MESSAGES.text);
  const number = text(raw.number, TEXT_LIMIT, MESSAGES.text);
  const validity = text(raw.validity, TEXT_LIMIT, MESSAGES.text);
  const delivery = text(raw.delivery, TEXT_LIMIT, MESSAGES.text);
  const payment = text(raw.payment, TEXT_LIMIT, MESSAGES.text);
  if (!customer || !title) fail(MESSAGES.required);

  if (typeof raw.date !== "string" || !isRealDate(raw.date)) fail(MESSAGES.date);
  const date = raw.date;

  const staff = staffList.find((s) => s.id === raw.staffId);
  if (!staff) fail(MESSAGES.staff);
  const staffPhoneRaw = raw.staffPhone === undefined ? "" : raw.staffPhone;
  if (typeof staffPhoneRaw !== "string" || charCount(staffPhoneRaw) > STAFF_PHONE_LIMIT) fail(MESSAGES.staffPhone);
  const staffPhone = staffPhoneRaw.trim();

  const numberLength = charCount(number);
  if (numberLength < 1 || numberLength > 100 || hasControlChar(number)) fail(MESSAGES.number);

  let catalogRevision: string | undefined;
  if (isCatalogType(quoteType)) {
    if (typeof raw.catalogRevision === "string") catalogRevision = raw.catalogRevision;
    if (options.catalog && catalogRevision !== options.catalog.revision) fail(MESSAGES.catalogRevision);
  }

  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > MAX_ITEMS) fail(MESSAGES.itemCount);
  const items = raw.items.map((it, idx) => validateItem(it, idx + 1, quoteType, options));

  const notesRaw = raw.notes === undefined ? "" : raw.notes;
  if (typeof notesRaw !== "string" || charCount(notesRaw) > NOTES_LIMIT) fail(MESSAGES.notes);

  try {
    calculate(items, quoteType);
  } catch (e) {
    if (e instanceof QuoteRangeError) fail(e.message);
    throw e;
  }

  const value: QuoteInput = {
    quoteType,
    customer,
    contact,
    phone,
    email,
    title,
    number,
    date,
    validity: PREFIX.validity + validity,
    delivery: PREFIX.delivery + delivery,
    payment: PREFIX.payment + payment,
    staffId: staff.id,
    staffDisplay: staffProfile(staff).display,
    staffPhone,
    notes: notesRaw,
    showFee: flag(raw.showFee),
    mergeCategories: flag(raw.mergeCategories),
    blankRows: flag(raw.blankRows),
    items,
  };
  if (catalogRevision !== undefined) value.catalogRevision = catalogRevision;
  return value;
}

/**
 * 생성 요청을 검증하고 정규화한다.
 * @param raw 요청 본문 (가공 전)
 * @param staff 서버 담당자 명단 (표시 이름은 여기서 가져온다)
 * @param options ④⑤ 가격표·사진 확인 함수
 */
export function validateQuote(raw: unknown, staff: readonly Staff[], options: ValidateOptions = {}): ValidationResult {
  try {
    return { ok: true, value: run(raw, staff, options) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    return { ok: false, error: MESSAGES.generic };
  }
}
