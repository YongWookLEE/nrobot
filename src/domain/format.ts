/**
 * 표기 도우미 (spec 12절 — 기존 pdf_quote.py 표기 규칙).
 */
import { B0, B1, B2, pow10 } from "./money";

const DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL_UNITS = ["", "십", "백", "천"];
const GROUP_UNITS = ["", "만", "억", "조", "경"];

/** 한글 금액 (기존 korean_amount). 0 → '영'. 십·백·천 앞의 '일'은 생략한다. */
export function koreanAmount(n: number | bigint): string {
  const text = (typeof n === "bigint" ? n : BigInt(Math.trunc(n))).toString();
  if (/^0+$/.test(text)) return "영";
  const groups: string[] = [];
  for (let end = text.length; end > 0; end -= 4) groups.unshift(text.slice(Math.max(0, end - 4), end));
  let out = "";
  groups.forEach((group, gi) => {
    const padded = group.padStart(4, "0");
    let part = "";
    for (let p = 0; p < 4; p += 1) {
      const d = Number(padded[p]);
      const unitIndex = 3 - p;
      if (d === 0) continue;
      part += (d === 1 && unitIndex > 0 ? "" : DIGITS[d]) + SMALL_UNITS[unitIndex];
    }
    if (part) out += part + GROUP_UNITS[groups.length - 1 - gi];
  });
  return out;
}

interface HasCategory {
  category?: string | null;
}

function trimmedCategory(item: HasCategory): string {
  return (item.category ?? "").trim();
}

/**
 * 묶음 순번. 묶기가 꺼져 있거나, 구분이 비었거나, 앞 품목과 구분이 다르면 번호가 늘어난다.
 */
export function categoryGroups(items: readonly HasCategory[], enabled: boolean): number[] {
  const out: number[] = [];
  let n = 0;
  let prev: string | null = null;
  for (const item of items) {
    const cat = trimmedCategory(item);
    if (!enabled || !cat || cat !== prev) n += 1;
    prev = cat;
    out.push(n);
  }
  return out;
}

/**
 * 같은 구분(비어 있지 않음)이 2개 이상 이어지는 구간 → [시작, 끝] (0부터 세는 품목 인덱스, 끝 포함).
 */
export function categorySpans(items: readonly HasCategory[], enabled: boolean): Array<[number, number]> {
  if (!enabled) return [];
  const spans: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i <= items.length; i += 1) {
    const cat = trimmedCategory(items[start] ?? {});
    const same = i < items.length && cat !== "" && trimmedCategory(items[i]) === cat;
    if (same) continue;
    if (cat !== "" && i - 1 > start) spans.push([start, i - 1]);
    start = i;
  }
  return spans;
}

const ITEM_NOTE_RE = /조달\s*식별\s*번호\s*[,，:：]?\s*([0-9][0-9-]*)/g;

/** 비고의 조달식별번호를 '조달식별번호\n번호' 형태로 바꾼다. */
export function formatItemNote(note: string): string {
  return note.replace(ITEM_NOTE_RE, "조달식별번호\n$1");
}

/** 실수(double)의 정확한 10진 값: digits / 10^scale */
function exactDecimal(x: number): { digits: bigint; scale: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << BigInt(32)) | BigInt(lo);
  let e: number;
  if (exponent === 0) {
    e = -1074;
  } else {
    mantissa |= B1 << BigInt(52);
    e = exponent - 1075;
  }
  if (e >= 0) return { digits: mantissa << BigInt(e), scale: 0 };
  return { digits: mantissa * BigInt(5) ** BigInt(-e), scale: -e };
}

function plainDecimal(digits: bigint, scale: number): string {
  if (scale <= 0) return (digits * pow10(-scale)).toString();
  const s = digits.toString().padStart(scale + 1, "0");
  const intPart = s.slice(0, s.length - scale);
  const frac = s.slice(s.length - scale).replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : intPart;
}

/**
 * 수량 표기. 파이썬 f"{q:g}"처럼 유효숫자 6자리(동률은 짝수 쪽)로 줄이고 끝의 0을 지운다.
 * 단, 지수 표기는 쓰지 않는다 (의도적 차이: 1000000 → "1000000", 기존은 "1e+06").
 */
export function qtyText(q: number): string {
  if (!Number.isFinite(q)) return String(q);
  if (q === 0) return "0";
  const sign = q < 0 ? "-" : "";
  const { digits, scale } = exactDecimal(Math.abs(q));
  const len = digits.toString().length;
  const drop = len - 6;
  if (drop <= 0) return sign + plainDecimal(digits, scale);
  const base = pow10(drop);
  let kept = digits / base;
  const rest = digits % base;
  const half = base / B2;
  if (rest > half || (rest === half && kept % B2 === B1)) kept += B1;
  return sign + plainDecimal(kept, scale - drop);
}

/** 파일명에 쓰는 거래처 이름: 금지 문자 → '_', 앞뒤 공백·점 제거, 40자, 비면 '거래처' */
export function safeCustomerName(name: string): string {
  const replaced = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^[ .]+|[ .]+$/g, "");
  const cut = Array.from(replaced).slice(0, 40).join("");
  return cut || "거래처";
}

/** 천 단위 쉼표 */
export function money(n: number | bigint): string {
  const value = typeof n === "bigint" ? n : BigInt(Math.round(n));
  const neg = value < B0;
  const s = (neg ? -value : value).toString();
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return (neg ? "-" : "") + out;
}

