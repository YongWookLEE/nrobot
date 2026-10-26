/**
 * 부동소수점 없이 금액을 다루는 정수 스케일 10진 도구.
 * 모든 값은 0 이상이고, 반올림은 ROUND_HALF_UP(사사오입)이다.
 */

/** ES2017 대상이라 bigint 리터럴(10n) 대신 상수를 쓴다. */
export const B0 = BigInt(0);
export const B1 = BigInt(1);
export const B2 = BigInt(2);
export const B10 = BigInt(10);

/** 10진 문자열 해석 결과: digits / 10^scale */
export interface Decimal {
  /** 부호 포함 정수 */
  digits: bigint;
  /** 소수 자릿수 (0 이상, 끝자리 0 제거 후 최소값) */
  scale: number;
}

const DECIMAL_RE = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/;

/** 10^n */
export function pow10(n: number): bigint {
  return B10 ** BigInt(n);
}

/**
 * 숫자 또는 문자열을 정확한 10진수로 읽는다. 읽을 수 없으면 null.
 * 숫자는 String(n)의 10진 표기를 그대로 쓴다 (예: 1.125 → "1.125"). 실수 곱셈은 하지 않는다.
 */
export function parseDecimal(value: unknown): Decimal | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }
  const m = DECIMAL_RE.exec(text);
  if (!m) return null;
  const [, sign, body, expText] = m;
  const [intPart, fracPart = ""] = body.split(".");
  const exp = expText ? Number(expText) : 0;
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 1000) return null;
  let digitsText = (intPart || "0") + fracPart;
  let scale = fracPart.length - exp;
  if (scale < 0) {
    digitsText += "0".repeat(-scale);
    scale = 0;
  }
  let digits = BigInt(digitsText);
  // 의미 없는 끝자리 0을 지워 scale을 최소화한다.
  while (scale > 0 && digits % B10 === B0) {
    digits /= B10;
    scale -= 1;
  }
  if (sign === "-") digits = -digits;
  return { digits, scale };
}

/** Decimal을 scale 자리 정수로 바꾼다. 소수 자릿수가 넘치면 null. */
export function toScaled(d: Decimal, scale: number): bigint | null {
  if (d.scale > scale) return null;
  return d.digits * pow10(scale - d.scale);
}

/** 값을 scale 자리 정수로 읽는다. 읽을 수 없거나 자릿수가 넘치면 오류. */
export function scaledOrThrow(value: unknown, scale: number): bigint {
  const d = parseDecimal(value);
  const s = d ? toScaled(d, scale) : null;
  if (s === null) throw new Error("숫자 형식이 올바르지 않습니다.");
  return s;
}

/** numerator / denominator 를 정수로 사사오입한다 (0 이상 값 전제). */
export function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * B2 + denominator) / (denominator * B2);
}

/** scaled / 10^scale 을 JS 숫자로 바꾼다 (표시·저장용. 계산에는 쓰지 않는다). */
export function scaledToNumber(scaled: bigint, scale: number): number {
  if (scale === 0) return Number(scaled);
  const neg = scaled < B0;
  const abs = neg ? -scaled : scaled;
  const base = pow10(scale);
  const frac = (abs % base).toString().padStart(scale, "0");
  return Number(`${neg ? "-" : ""}${abs / base}.${frac}`);
}
