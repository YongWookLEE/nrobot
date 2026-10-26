// 기존 파이썬(xlsx_quote.py) 계산과 같은 결과를 내는 작은 도구.
// 좌표 격자는 소수 둘째 자리 반올림 값으로 칸 경계를 맞추므로, 덧셈·반올림 방식이 같아야 병합 범위가 같아진다.

/** 합할 값. isInt=true는 파이썬 int, false는 float */
export interface PyNum {
  value: number;
  isInt: boolean;
}

/**
 * Python 3.12 sum(): 정수만 나오는 동안은 정수 합, 처음 실수가 나오면 그 뒤로는
 * 실수끼리 Neumaier 보정 합(정수는 보정 없이 더함).
 */
export function pySum(items: readonly PyNum[]): number {
  let i = 0;
  let intSum = 0;
  while (i < items.length && items[i].isInt) intSum += items[i++].value;
  if (i === items.length) return intSum;
  let f = intSum + items[i++].value;
  let c = 0;
  for (; i < items.length; i++) {
    const { value: x, isInt } = items[i];
    if (isInt) {
      f += x;
      continue;
    }
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}

/** 실수 목록의 Python sum() */
export function fsum(values: readonly number[]): number {
  return pySum(values.map((value) => ({ value, isInt: false })));
}

/**
 * Python round(x, 2). 정확한 이진값 기준으로 가장 가까운 값, 정확히 가운데면 짝수 쪽.
 * 소수 셋째 자리가 정확히 5인 double은 x*8이 홀수 정수인 경우뿐이다.
 */
export function round2(x: number): number {
  if (Number.isInteger(x * 8) && !Number.isInteger(x * 4)) {
    const n = x * 100;
    const f = Math.floor(n);
    return (f % 2 === 0 ? f : f + 1) / 100;
  }
  return Number(x.toFixed(2));
}

/** 줄 끝 문자 코드: LF VT FF CR FS GS RS NEL LS PS */
const LINE_BREAK_CODES = new Set([10, 11, 12, 13, 28, 29, 30, 133, 8232, 8233]);

/**
 * Python str.splitlines(): 줄 끝 문자로 나누고, 마지막 빈 조각은 버린다.
 */
export function splitLines(s: string): string[] {
  if (s === "") return [];
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (LINE_BREAK_CODES.has(code)) {
      parts.push(cur);
      cur = "";
      if (code === 13 && s.charCodeAt(i + 1) === 10) i++;
    } else {
      cur += s[i];
    }
  }
  parts.push(cur);
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * 기존 height(): 한글은 1em, 라틴 문자는 0.55em으로 보고 줄 수를 어림한 높이(pt).
 */
export function textHeight(text: string, width: number, size = 11): number {
  const lines = text.split("\n");
  let count = 0;
  for (const line of lines) {
    const units = pySum(Array.from(line).map((ch) => (ch.codePointAt(0)! > 255 ? { value: 1, isInt: true } : { value: 0.55, isInt: false })));
    count += Math.max(1, Math.ceil((units * size) / Math.max(1, width - 6)));
  }
  return Math.max(1, count) * size * 1.35 + 6;
}
