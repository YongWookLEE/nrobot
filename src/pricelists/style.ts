// 기존 excel_style.py 이식: 셀 서식(글꼴·크기·굵기·색·채움·정렬), 열 너비·행 높이.
import type { CellStyle } from "@/domain/types";
import { child, childrenNamed, findAll, firstDescendant, parseXml, type XmlElement } from "./xml";
import type { ZipReader } from "./zip";

/** Python round(x): 가운데 값은 짝수로 (banker's rounding). */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

const DEFAULT_THEME = ["FFFFFF", "000000", "EEECE1", "1F497D", "4F81BD", "C0504D", "9BBB59", "8064A2", "4BACC6", "F79646"];
const THEME_KEYS = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

/** Python float() 처럼 앞뒤 공백 허용 */
function pyFloat(s: string): number {
  const t = s.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) && !/^[+-]?(inf|infinity|nan)$/i.test(t)) {
    throw new Error(`숫자 형식이 아닙니다: ${s}`);
  }
  if (/inf/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  if (/nan/i.test(t)) return NaN;
  return Number(t);
}

function pyInt(s: string): number {
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) throw new Error(`정수 형식이 아닙니다: ${s}`);
  return parseInt(t, 10);
}

export class Styles {
  private fonts: XmlElement[];
  private fills: XmlElement[];
  private xfs: XmlElement[];
  readonly theme: string[];

  constructor(zip: ZipReader) {
    const root = parseXml(zip.read("xl/styles.xml"));
    this.fonts = child(root, "fonts")?.children ?? [];
    this.fills = child(root, "fills")?.children ?? [];
    this.xfs = child(root, "cellXfs")?.children ?? [];
    let theme = DEFAULT_THEME;
    if (zip.has("xl/theme/theme1.xml")) {
      const scheme = firstDescendant(parseXml(zip.read("xl/theme/theme1.xml")), "clrScheme");
      if (scheme) {
        const entries: Record<string, string> = {};
        for (const e of scheme.children) {
          const first = e.children[0];
          if (!first) throw new Error("테마 색 형식이 잘못되었습니다.");
          entries[e.name] = first.attrs.lastClr ?? first.attrs.val ?? "000000";
        }
        theme = THEME_KEYS.map((k) => entries[k] ?? "000000");
      }
    }
    this.theme = theme;
  }

  /** excel_style.Styles.color: rgb 또는 theme + tint */
  colorOf(attrs: Record<string, string> | null | undefined, fallback: string): string {
    if (!attrs) return fallback;
    let value: string | null = null;
    if (attrs.rgb) value = attrs.rgb.slice(-6);
    else if (attrs.theme !== undefined) {
      const idx = pyInt(attrs.theme);
      const len = this.theme.length;
      value = this.theme[((idx % len) + len) % len];
    }
    if (value === null) return fallback;
    const tint = pyFloat(attrs.tint ?? "0");
    const rgb = [0, 2, 4].map((i) => {
      const part = value!.slice(i, i + 2);
      if (!/^[0-9a-fA-F]+$/.test(part)) throw new Error(`색 형식이 잘못되었습니다: ${value}`);
      return parseInt(part, 16);
    });
    return (
      "#" +
      rgb
        .map((c) => roundHalfEven(tint < 0 ? c * (1 + tint) : c + (255 - c) * tint))
        .map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  /** excel_style.Styles.cell */
  cell(c: XmlElement | null | undefined): CellStyle {
    const xf = c ? this.xfs[pyInt(c.attrs.s ?? "0")] : this.xfs[0];
    if (!xf) throw new Error("셀 서식 번호가 잘못되었습니다.");
    const f = this.fonts[pyInt(xf.attrs.fontId ?? "0")];
    const fillEl = this.fills[pyInt(xf.attrs.fillId ?? "0")];
    if (!f || !fillEl) throw new Error("셀 서식 번호가 잘못되었습니다.");
    const fill = child(fillEl, "patternFill");
    const name = child(f, "name");
    const size = child(f, "sz");
    const align = child(xf, "alignment");
    return {
      font: name ? (name.attrs.val ?? "") : "맑은 고딕",
      size: size ? pyFloat(size.attrs.val ?? "") : 11,
      bold: child(f, "b") !== null,
      color: this.colorOf(child(f, "color")?.attrs, "#000000"),
      fill: fill && fill.attrs.patternType === "solid" ? this.colorOf(child(fill, "fgColor")?.attrs, "#FFFFFF") : "#FFFFFF",
      align: align ? (align.attrs.horizontal ?? "left") : "left",
    };
  }
}

/** excel_style.sheet_metrics: A~J 열 너비(pt), 행 높이(pt) */
export function sheetMetrics(root: XmlElement): { columns: number[]; rows: Map<number, number> } {
  const columns = new Array<number>(10).fill((8.43 * 7 + 5) * 0.75);
  for (const c of findAll(root, ["cols", "col"])) {
    const min = pyInt(c.attrs.min ?? "");
    const max = pyInt(c.attrs.max ?? "");
    for (let i = min - 1; i < Math.min(10, max); i++) {
      if (i < 0) continue; // Python 음수 인덱스는 실제 xlsx에서 나오지 않는다
      columns[i] = c.attrs.hidden === "1" ? 0 : (pyFloat(c.attrs.width ?? "8.43") * 7 + 5) * 0.75;
    }
  }
  const rows = new Map<number, number>();
  for (const r of childrenNamed(child(root, "sheetData"), "row")) {
    rows.set(pyInt(r.attrs.r ?? ""), pyFloat(r.attrs.ht ?? "15"));
  }
  return { columns, rows };
}

/**
 * Python 3.12 sum(): 정수만 나오는 동안은 정수 합, 처음 실수가 나오면 그 뒤로는
 * 실수끼리 Neumaier 보정 합(정수는 보정 없이 더함). 행 높이 합을 기존과 똑같이 만든다.
 */
export function pySum(items: Array<{ value: number; isInt: boolean }>): number {
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
