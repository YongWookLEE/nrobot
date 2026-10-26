// 문단 줄바꿈: reportlab Paragraph(wordWrap='CJK') 동작을 옮긴 것.
// - 공백 묶음은 한 칸으로 줄이고 문단 앞뒤 공백은 지운다 (줄바꿈 '\n' 은 <br/> 과 같다).
// - 글자 단위로 채우다 넘치면 자른다 (reportlab textsplit.dumbSplit / paragraph.cjkFragSplit).
//   영문 구간에서 넘치면 줄의 뒤쪽 절반 안에서 공백·한글 위치까지 물러나 자른다.
//   줄 첫머리에 올 수 없는 문장부호는 앞줄 끝에 매단다.

/** 한 글자 폭(pt) */
export type CharWidth = (ch: string) => number;

export interface TextLine {
  text: string;
  /** 줄 오른쪽 남는 폭 (정렬 계산용. reportlab extraSpace) */
  extra: number;
}

const FUZZ = 1e-6;

const ALL_CANNOT_START =
  "!',.:;?!\")]、。」』】〕］】）" +
  "々―ぁぃぅぇぉっゃゅょゎァィ" +
  "ゥェォッャュョヮーヵヶ" +
  "゛゜・ヽヾゝゞ―‐\xb0′″℃￠％‰";

/** 유니코드 Zs(공백 구분자) */
const ZS = /^\p{Zs}$/u;

const codePoint = (ch: string): number => ch.codePointAt(0) ?? 0;

/** 문단 공백 정리: 공백 묶음 → 한 칸 (줄바꿈은 남긴다) */
function collapse(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t\f\v]+/g, " ");
}

/** 한 덩어리(줄바꿈 없는 글자열)를 폭에 맞게 자른다. strip=true 면 중간 줄의 앞뒤 공백을 지운다 (dumbSplit). */
function splitRun(chars: string[], widths: number[], maxWidth: number, strip: boolean, out: TextLine[]): boolean {
  let i = 0;
  let used = 0;
  let start = 0;
  const n = chars.length;
  while (i < n) {
    let w = widths[i];
    let c = chars[i];
    used += w;
    i += 1;
    if (used > maxWidth + FUZZ && used > 0) {
      let extra = maxWidth - used;
      if (codePoint(c) < 0x3000) {
        const limit = (start + i) >> 1;
        for (let j = i - 1; j > limit; j -= 1) {
          const cj = chars[j];
          if (ZS.test(cj) || codePoint(cj) >= 0x3000) {
            const k = j + 1;
            if (k < i) {
              const jj = k + 1;
              for (let t = jj; t < i; t += 1) extra += widths[t];
              w = widths[k];
              c = chars[k];
              i = jj;
              break;
            }
          }
        }
      }
      if (!ALL_CANNOT_START.includes(c) && i > start + 1) {
        i -= 1;
        extra += w;
      }
      const piece = chars.slice(start, i).join("");
      out.push({ text: strip ? piece.trim() : piece, extra });
      start = i;
      used = 0;
    }
  }
  if (used > 0) {
    out.push({ text: chars.slice(start).join(""), extra: maxWidth - used });
    return true;
  }
  return false;
}

/**
 * 문단을 줄로 나눈다.
 * @param text 원문 ('\n' 은 강제 줄바꿈)
 * @param maxWidth 줄 폭(pt)
 * @param charWidth 글자 폭 함수
 */
export function wrapParagraph(text: string, maxWidth: number, charWidth: CharWidth): TextLine[] {
  const collapsed = collapse(text);
  const lines: TextLine[] = [];
  if (!collapsed.includes("\n")) {
    const body = collapsed.trim();
    if (!body) return lines;
    const chars = Array.from(body);
    splitRun(chars, chars.map(charWidth), maxWidth, true, lines);
    return lines;
  }
  // 여러 덩어리(<br/>): 문단 맨 앞·맨 끝 공백만 지운다. 줄바꿈마다 줄이 끝나고, 마지막 줄바꿈 뒤가 비면 줄을 만들지 않는다.
  const segments = collapsed.replace(/^[ \t\f\v]+/, "").replace(/[ \t\f\v]+$/, "").split("\n");
  segments.forEach((seg, idx) => {
    const chars = Array.from(seg);
    // 덩어리 안의 넘침 줄바꿈 (cjkFragSplit: 앞뒤 공백을 지우지 않는다)
    const hadTail = splitRun(chars, chars.map(charWidth), maxWidth, false, lines);
    // 줄바꿈 문자에서 줄이 끝난다: 남은 글자가 없으면 빈 줄이 된다.
    if (idx < segments.length - 1 && !hadTail) lines.push({ text: "", extra: maxWidth });
  });
  return lines;
}
