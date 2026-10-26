// Python Decimal(str) 해석을 따라 하는 작은 십진수. 값 = sign * digits * 10^exp

export type PyDecimal =
  | { kind: "finite"; negative: boolean; digits: bigint; exp: number }
  | { kind: "nonfinite" };

/** 유니코드 숫자(전각 등)를 ASCII로. Python Decimal은 모든 Nd 숫자를 받는다. */
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (ch) => {
    // 숫자 블록은 0~9가 연속이고, 이어 붙은 블록(수학 숫자 등)도 10개 단위다.
    const cp = ch.codePointAt(0)!;
    let run = cp;
    while (/\p{Nd}/u.test(String.fromCodePoint(run - 1))) run--;
    return String((cp - run) % 10);
  });
}

export function parsePyDecimal(raw: string): PyDecimal | null {
  const s = asciiDigits(raw.trim().replace(/_/g, ""));
  if (/^[+-]?(inf|infinity|s?nan\d*)$/i.test(s)) return { kind: "nonfinite" };
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return null;
  const [, sign, int = "", frac = "", exp] = m;
  if (int === "" && frac === "") return null;
  const e = exp ? Number(exp) : 0;
  if (!Number.isFinite(e)) return null;
  const digitText = int + frac || "0";
  // 지수가 아주 크거나 작아도 우리가 쓰는 판단(범위·반올림·정수 여부)은 같으므로 계산량만 줄인다.
  const exp10 = Math.max(-(digitText.length + 50), Math.min(400, e - frac.length));
  return { kind: "finite", negative: sign === "-", digits: BigInt(digitText), exp: exp10 };
}

const pow10 = (n: number) => BigInt(10) ** BigInt(n);

/** 값이 lo..hi(정수) 안인지 정확히 비교 */
export function decimalInRange(d: Extract<PyDecimal, { kind: "finite" }>, lo: bigint, hi: bigint): boolean {
  if (d.digits === BigInt(0)) return lo <= BigInt(0) && BigInt(0) <= hi;
  if (d.negative) {
    // 음수: 0보다 작다. lo가 0 이상이면 범위 밖
    if (lo >= BigInt(0)) return false;
    throw new Error("음수 하한은 지원하지 않습니다.");
  }
  if (d.exp >= 0) {
    if (d.exp > 40) return false; // 어떤 하한·상한보다 크다
    const v = d.digits * pow10(d.exp);
    return lo <= v && v <= hi;
  }
  const scale = pow10(-d.exp);
  return lo * scale <= d.digits && d.digits <= hi * scale;
}

/** 원 단위 사사오입 (ROUND_HALF_UP). 범위 확인 뒤 부르므로 0 이상이다. */
export function roundHalfUpToInt(d: Extract<PyDecimal, { kind: "finite" }>): number {
  if (d.exp >= 0) return Number(d.digits * pow10(d.exp));
  const scale = pow10(-d.exp);
  const q = d.digits / scale;
  const r = d.digits % scale;
  const v = r * BigInt(2) >= scale ? q + BigInt(1) : q;
  return Number(d.negative ? -v : v) || 0;
}

/** 정수인지 (n == int(n)) */
export function decimalIsInteger(d: Extract<PyDecimal, { kind: "finite" }>): boolean {
  if (d.exp >= 0 || d.digits === BigInt(0)) return true;
  return d.digits % pow10(-d.exp) === BigInt(0);
}

/** int(n): 0쪽으로 자른 정수 */
export function decimalToInt(d: Extract<PyDecimal, { kind: "finite" }>): number {
  const v = d.exp >= 0 ? d.digits * pow10(Math.min(d.exp, 400)) : d.digits / pow10(-d.exp);
  return Number(d.negative ? -v : v) || 0;
}
