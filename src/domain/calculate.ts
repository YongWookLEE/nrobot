/**
 * 견적 계산 (spec 7절 — 기존 quote.py 규칙 그대로, 변경 금지).
 * 수량은 소수 3자리, 적용률은 2자리 정수 스케일로 바꿔 BigInt로만 계산한다.
 */
import { B0, divHalfUp, pow10, scaledOrThrow } from "./money";
import type { CatalogTotals, QuoteTotals, QuoteType } from "./types";

export const TOTAL_RANGE_ERROR = "견적 합계가 지원 범위를 초과합니다.";

/** 견적가 상한 (원) */
export const MAX_TOTAL = BigInt("9999999999999");

/** ④⑤ 할인 기준 금액 */
export const CATALOG_DISCOUNT_THRESHOLD = BigInt(50_000_000);

const QTY_SCALE = 3;
const RATE_SCALE = 2;
/** 수량(10^3) × 적용률(10^2) × 100% 의 분모 */
const LINE_DENOMINATOR = pow10(QTY_SCALE + RATE_SCALE + 2);

/** 계산에 필요한 품목 값. 숫자 또는 10진 문자열. */
export interface CalcItem {
  qty: number | string;
  price?: number | string;
  priceRate?: number | string;
  material?: number | string;
  labor?: number | string;
  expense?: number | string;
}

/** 견적 합계 범위 초과 오류 */
export class QuoteRangeError extends Error {
  constructor() {
    super(TOTAL_RANGE_ERROR);
    this.name = "QuoteRangeError";
  }
}

function money(value: number | string | undefined): bigint {
  return value === undefined ? B0 : scaledOrThrow(value, 0);
}

/** 품목 단가: ③은 재료비+노무비+경비, 나머지는 price */
export function unitPriceBig(item: CalcItem, type: QuoteType): bigint {
  if (type === "cost") return money(item.material) + money(item.labor) + money(item.expense);
  return money(item.price);
}

/** 줄 금액 = round(수량 × 단가 × 적용률 ÷ 100) — BigInt */
export function lineAmountBig(item: CalcItem, type: QuoteType): bigint {
  const qty = scaledOrThrow(item.qty, QTY_SCALE);
  const rate = scaledOrThrow(item.priceRate ?? 100, RATE_SCALE);
  return divHalfUp(qty * unitPriceBig(item, type) * rate, LINE_DENOMINATOR);
}

/** 줄 금액 (원) */
export function lineAmount(item: CalcItem, type: QuoteType): number {
  return Number(lineAmountBig(item, type));
}

/** 합계 계산 — BigInt. 범위를 넘으면 QuoteRangeError. */
export function calculateBig(items: readonly CalcItem[], type: QuoteType): { subtotal: bigint; tax: bigint; total: bigint } {
  let subtotal = B0;
  for (const item of items) subtotal += lineAmountBig(item, type);
  let tax = B0;
  let total: bigint;
  if (type === "vat" || type === "cost") {
    tax = divHalfUp(subtotal, BigInt(10));
    total = subtotal + tax;
  } else if (type === "total") {
    total = subtotal;
  } else {
    total = subtotal >= CATALOG_DISCOUNT_THRESHOLD ? divHalfUp(subtotal * BigInt(98), BigInt(100)) : subtotal;
  }
  if (total > MAX_TOTAL) throw new QuoteRangeError();
  return { subtotal, tax, total };
}

/** 합계 계산 {subtotal, tax, total} (원). 견적가가 9,999,999,999,999를 넘으면 QuoteRangeError. */
export function calculate(items: readonly CalcItem[], type: QuoteType): QuoteTotals {
  const r = calculateBig(items, type);
  return { subtotal: Number(r.subtotal), tax: Number(r.tax), total: Number(r.total) };
}

/** ④⑤ 할인·조달수수료. 수수료는 계산만 하고 견적가에 더하지 않는다. */
export function catalogTotals(subtotal: number | bigint): CatalogTotals {
  const s = typeof subtotal === "bigint" ? subtotal : scaledOrThrow(subtotal, 0);
  const discounted = s >= CATALOG_DISCOUNT_THRESHOLD ? divHalfUp(s * BigInt(98), BigInt(100)) : s;
  const fee = divHalfUp(discounted * BigInt(54), BigInt(10000));
  return { discounted: Number(discounted), fee: Number(fee), withFee: Number(discounted + fee) };
}

/** ③ 노무비 자동값 = round(재료비 × 2.8125) */
export function autoLabor(material: number | string): number {
  return Number(divHalfUp(scaledOrThrow(material, 0) * BigInt(28125), BigInt(10000)));
}

/** ③ 경비 자동값 = round(노무비 × 0.03) */
export function autoExpense(labor: number | string): number {
  return Number(divHalfUp(scaledOrThrow(labor, 0) * BigInt(3), BigInt(100)));
}
