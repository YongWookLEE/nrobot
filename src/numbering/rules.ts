/**
 * 견적번호 순수 계산 (저장소에 접근하지 않는다). 기존 numbering.py와 같은 규칙이다.
 */
import {
  MSG_DATE_INVALID,
  MSG_DUPLICATE,
  MSG_EXHAUSTED,
  MSG_MANUAL_INVALID,
  QuoteNumberError,
  type QuoteNumberEntry,
  type StaffStart,
} from "./types";

export const NUMBER_PREFIX = "NSFF0";
export const MAX_SERIAL = 999;
export const MANUAL_MAX_LENGTH = 100;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER_RE = /^NSFF0-(\d{4})(\d{2})(\d{2})-(\d{3})$/;

/** YYYY-MM-DD → YYYYMMDD. 형식이 틀리면 오류. */
function compactDate(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new QuoteNumberError(MSG_DATE_INVALID);
  return m[1] + m[2] + m[3];
}

/** 견적번호 `NSFF0-YYYYMMDD-NNN`을 만든다. date는 작성일 YYYY-MM-DD, serial은 1~999. */
export function formatNumber(date: string, serial: number): string {
  const ymd = compactDate(date);
  if (!Number.isInteger(serial) || serial < 1 || serial > MAX_SERIAL) {
    throw new QuoteNumberError(MSG_EXHAUSTED);
  }
  return `${NUMBER_PREFIX}-${ymd}-${String(serial).padStart(3, "0")}`;
}

/** `NSFF0-YYYYMMDD-NNN` 형식이면 { date: YYYY-MM-DD, serial }, 아니면 null */
export function parseNumber(number: string): { date: string; serial: number } | null {
  const m = NUMBER_RE.exec(number);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, serial: Number(m[4]) };
}

/**
 * 그 날짜에 이미 쓰인 일련번호 집합.
 * 자동 번호는 기록된 날짜 기준, 직접 입력 번호는 번호 문자열에 적힌 날짜 기준이다.
 */
function usedSerials(history: readonly QuoteNumberEntry[], date: string): Set<number> {
  const used = new Set<number>();
  for (const e of history) {
    const parsed = parseNumber(e.number);
    if (!parsed) continue;
    if (e.manual ? parsed.date === date : e.date === date) used.add(parsed.serial);
  }
  return used;
}

/**
 * 다음 자동 일련번호.
 * max(시작값, 그 담당자가 그날 자동으로 받은 최대 번호 + 1)에서 시작해, 그날 쓰인 번호(다른 담당자·직접 입력 포함)는 건너뛴다.
 * 999를 넘으면 "해당 날짜의 견적번호를 모두 사용했습니다." 오류.
 */
export function nextSerial(history: readonly QuoteNumberEntry[], date: string, staff: StaffStart): number {
  compactDate(date);
  let mine = 0;
  for (const e of history) {
    if (e.manual || e.date !== date || e.staffId !== staff.id) continue;
    const parsed = parseNumber(e.number);
    if (parsed && parsed.date === date && parsed.serial > mine) mine = parsed.serial;
  }
  const used = usedSerials(history, date);
  let serial = mine > 0 ? Math.max(staff.start, mine + 1) : staff.start;
  while (used.has(serial)) serial += 1;
  if (serial > MAX_SERIAL) throw new QuoteNumberError(MSG_EXHAUSTED);
  return serial;
}

/** 직접 입력 번호 형식 검사: 1~100자, 공백만은 안 됨, 제어문자(코드 32 미만) 없음 */
function isValidManualText(number: string): boolean {
  if (number.length < 1 || number.length > MANUAL_MAX_LENGTH) return false;
  if (number.trim() === "") return false;
  for (let i = 0; i < number.length; i++) {
    if (number.charCodeAt(i) < 32) return false;
  }
  return true;
}

/**
 * 직접 입력 번호를 검사한다. 문제가 있으면 QuoteNumberError를 던진다.
 * - 형식 오류: "견적번호는 1~100자로 입력하세요."
 * - 직접 입력 이력에 같은 문자열이 있거나, `NSFF0-YYYYMMDD-NNN` 형식이고 그 날짜·번호가 자동 발급된 적 있으면
 *   "이미 발급된 견적번호입니다. 다른 번호를 입력하세요." (날짜는 작성일이 아니라 번호 문자열에서 읽는다)
 */
export function checkManual(history: readonly QuoteNumberEntry[], number: string): void {
  if (!isValidManualText(number)) throw new QuoteNumberError(MSG_MANUAL_INVALID);
  const parsed = parseNumber(number);
  for (const e of history) {
    if (e.manual) {
      if (e.number === number) throw new QuoteNumberError(MSG_DUPLICATE);
      continue;
    }
    if (!parsed || e.date !== parsed.date) continue;
    const issued = parseNumber(e.number);
    if (issued && issued.serial === parsed.serial) throw new QuoteNumberError(MSG_DUPLICATE);
  }
}

/** 저장소에서 읽은 값이 이력 한 건의 모양인지 */
export function isQuoteNumberEntry(value: unknown): value is QuoteNumberEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.date === "string" &&
    typeof v.staffId === "string" &&
    typeof v.number === "string" &&
    typeof v.manual === "boolean"
  );
}
