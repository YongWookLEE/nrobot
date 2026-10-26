// reportlab 표·문단 배치를 pdfkit 위에서 흉내 내는 작은 배치 엔진.
// 좌표는 위에서 아래로 늘어나는 pdfkit 좌표(pt)를 쓴다. 높이·위치 계산식은 reportlab 4.x
// (platypus.tables.Table, platypus.paragraph.Paragraph)과 같게 맞춘다.
import type PDFKit from "pdfkit";
import { wrapParagraph, type TextLine } from "./text";

export type FontRole = "regular" | "bold";

/** 문단 서식 (reportlab ParagraphStyle 일부) */
export interface ParaStyle {
  font: FontRole;
  size: number;
  leading: number;
  /** 0 왼쪽, 1 가운데, 2 오른쪽 */
  align: 0 | 1 | 2;
  color: string;
}

/** 그리기 도구: pdfkit 문서 + 글꼴 폭 */
export class Canvas {
  private readonly widthCache = new Map<string, number>();

  constructor(
    readonly doc: PDFKit.PDFDocument,
    private readonly fontNames: Record<FontRole, string>,
  ) {}

  /** 1pt 크기 기준 글자 폭 */
  private unitWidth(role: FontRole, ch: string): number {
    const key = role + ch;
    const cached = this.widthCache.get(key);
    if (cached !== undefined) return cached;
    // 줄바꿈 없는 공백(nbsp)은 보통 공백 폭으로 잰다 (그릴 때도 공백으로 바꾼다)
    const glyph = ch === " " ? " " : ch;
    this.doc.font(this.fontNames[role]).fontSize(1000);
    const w = this.doc.widthOfString(glyph) / 1000;
    this.widthCache.set(key, w);
    return w;
  }

  charWidth(role: FontRole, size: number): (ch: string) => number {
    return (ch) => this.unitWidth(role, ch) * size;
  }

  /** 기준선 위치에 글자를 쓴다 */
  drawText(text: string, x: number, baseline: number, style: ParaStyle): void {
    const shown = text.replace(/ /g, " ");
    if (!shown) return;
    this.doc
      .font(this.fontNames[style.font])
      .fontSize(style.size)
      .fillColor(style.color)
      .text(shown, x, baseline, { lineBreak: false, baseline: "alphabetic" });
  }
}

/** 배치 요소 (reportlab Flowable) */
export interface Flow {
  /** 주어진 폭에서의 크기 */
  wrap(c: Canvas, availWidth: number): { w: number; h: number };
  /** 왼쪽 위 (x, top)에 그린다. 직전 wrap 결과를 쓴다. */
  draw(c: Canvas, x: number, top: number): void;
}

/** 문단 */
export class Para implements Flow {
  private lines: TextLine[] = [];

  constructor(
    readonly text: string,
    readonly style: ParaStyle,
  ) {}

  wrap(c: Canvas, availWidth: number): { w: number; h: number } {
    this.lines = wrapParagraph(this.text, availWidth, c.charWidth(this.style.font, this.style.size));
    return { w: availWidth, h: this.lines.length * this.style.leading };
  }

  /** 높이만 잰다 (그리기용 줄 정보는 바꾸지 않는다) */
  measure(c: Canvas, availWidth: number): number {
    return wrapParagraph(this.text, availWidth, c.charWidth(this.style.font, this.style.size)).length * this.style.leading;
  }

  draw(c: Canvas, x: number, top: number): void {
    const { size, leading, align } = this.style;
    this.lines.forEach((line, i) => {
      const offset = align === 1 ? line.extra / 2 : align === 2 ? line.extra : 0;
      c.drawText(line.text, x + offset, top + size + i * leading, this.style);
    });
  }
}

/** 빈 칸 */
export class Spacer implements Flow {
  constructor(readonly height: number) {}
  wrap(): { w: number; h: number } {
    return { w: 0, h: this.height };
  }
  draw(): void {}
}

/** 그림 */
export class Picture implements Flow {
  constructor(
    /** pdfkit openImage() 결과 */
    readonly image: unknown,
    public drawWidth: number,
    public drawHeight: number,
  ) {}

  /** reportlab Image._restrictSize: 넘치면 비율 유지로 줄인다 */
  restrictSize(aw: number, ah: number): void {
    if (this.drawWidth > aw + 1e-6 || this.drawHeight > ah + 1e-6) {
      const factor = Math.min(aw / this.drawWidth, ah / this.drawHeight);
      this.drawWidth *= factor;
      this.drawHeight *= factor;
    }
  }

  wrap(): { w: number; h: number } {
    return { w: this.drawWidth, h: this.drawHeight };
  }

  draw(c: Canvas, x: number, top: number): void {
    // pdfkit image()는 연 그림 객체도 받는다 (같은 그림은 한 번만 넣는다)
    (c.doc.image as (src: unknown, x: number, y: number, o: object) => unknown)(this.image, x, top, {
      width: this.drawWidth,
      height: this.drawHeight,
      ignoreOrientation: true,
    });
  }
}

/** 셀 범위 [열0, 행0, 열1, 행1] (음수는 끝에서부터, reportlab 과 같다) */
export type CellRange = [number, number, number, number];

export interface Padding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type VAlign = "TOP" | "MIDDLE" | "BOTTOM";
export type HAlign = "LEFT" | "CENTER" | "RIGHT";

export interface TableOptions {
  colWidths: number[];
  /** 행 높이. null 이면 내용에 맞춘다 */
  rowHeights?: Array<number | null> | null;
  /** 전체 기본 여백 (reportlab 기본값 6/6/3/3) */
  padding?: Partial<Padding>;
  /** 범위별 여백 */
  paddingRanges?: Array<{ range: CellRange; padding: Partial<Padding> }>;
  valign?: VAlign;
  align?: HAlign;
  /** 격자 선 굵기 (없으면 선 없음) */
  grid?: number;
  backgrounds?: Array<{ range: CellRange; color: string }>;
  spans?: CellRange[];
}

/** 표 셀 내용. null 은 빈 문자열 칸(reportlab 기본 글꼴 10pt·줄간격 12pt 한 줄 높이). */
export type Cell = Flow | null;

const DEFAULT_PADDING: Padding = { left: 6, right: 6, top: 3, bottom: 3 };
const EMPTY_STRING_HEIGHT = 12;

interface SpanInfo {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** 표 (reportlab Table) */
export class Table implements Flow {
  readonly rows: Cell[][];
  readonly colWidths: number[];
  private readonly nRows: number;
  private readonly nCols: number;
  private readonly pads: Padding[][];
  private readonly spanAt = new Map<string, SpanInfo>();
  private readonly hidden = new Set<string>();
  private heights: number[] | null = null;

  constructor(
    rows: Cell[][],
    readonly opts: TableOptions,
  ) {
    this.rows = rows;
    this.colWidths = opts.colWidths;
    this.nRows = rows.length;
    this.nCols = opts.colWidths.length;
    const base = { ...DEFAULT_PADDING, ...opts.padding };
    this.pads = rows.map(() => opts.colWidths.map(() => ({ ...base })));
    for (const { range, padding } of opts.paddingRanges ?? []) {
      this.eachCell(range, (c, r) => Object.assign(this.pads[r][c], padding));
    }
    for (const range of opts.spans ?? []) {
      const [c0, r0, c1, r1] = this.norm(range);
      if (c0 === c1 && r0 === r1) continue;
      this.spanAt.set(`${c0},${r0}`, { c0, r0, c1, r1 });
      for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) if (r !== r0 || c !== c0) this.hidden.add(`${c},${r}`);
    }
  }

  private norm([c0, r0, c1, r1]: CellRange): CellRange {
    const fc = (v: number) => (v < 0 ? this.nCols + v : v);
    const fr = (v: number) => (v < 0 ? this.nRows + v : v);
    return [fc(c0), fr(r0), fc(c1), fr(r1)];
  }

  private eachCell(range: CellRange, fn: (c: number, r: number) => void): void {
    const [c0, r0, c1, r1] = this.norm(range);
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) if (r >= 0 && r < this.nRows && c >= 0 && c < this.nCols) fn(c, r);
  }

  private colPos(c: number): number {
    let x = 0;
    for (let i = 0; i < c; i += 1) x += this.colWidths[i];
    return x;
  }

  /** 셀(또는 병합 영역)의 폭 */
  private cellWidth(c: number, r: number): number {
    const span = this.spanAt.get(`${c},${r}`);
    if (!span) return this.colWidths[c];
    return this.colPos(span.c1 + 1) - this.colPos(span.c0);
  }

  private contentHeight(c: Canvas, cell: Cell, availWidth: number): { w: number; h: number } {
    if (cell === null) return { w: 0, h: EMPTY_STRING_HEIGHT };
    return cell.wrap(c, availWidth);
  }

  /** 행 높이 계산 (reportlab Table._calc_height + spanFixDim) */
  private computeHeights(c: Canvas): number[] {
    const given = this.opts.rowHeights ?? this.rows.map(() => null);
    const heights = given.map((h) => (h === null ? 0 : h));
    const spanCons = new Map<string, number>();
    for (let r = 0; r < this.nRows; r += 1) {
      if (given[r] !== null) continue;
      let h = 0;
      for (let col = 0; col < this.nCols; col += 1) {
        const key = `${col},${r}`;
        if (this.hidden.has(key)) continue;
        const pad = this.pads[r][col];
        const width = this.cellWidth(col, r);
        let t = this.contentHeight(c, this.rows[r][col] ?? null, width - pad.left - pad.right).h + pad.top + pad.bottom;
        const span = this.spanAt.get(key);
        if (span && span.r0 !== span.r1) {
          const k = `${span.r0},${span.r1}`;
          spanCons.set(k, Math.max(spanCons.get(k) ?? t, t));
          t = 0;
        }
        if (t > h) h = t;
      }
      heights[r] = h;
    }
    // 여러 행 병합 칸이 더 높으면 내용 맞춤 행에 똑같이 나눠 준다
    const extra = new Map<number, number>();
    const cons = [...spanCons.entries()].map(([k, v]) => ({ r0: Number(k.split(",")[0]), r1: Number(k.split(",")[1]), v }));
    cons.sort((a, b) => b.v - a.v || b.r0 - a.r0 || b.r1 - a.r1);
    for (const { r0, r1, v } of cons) {
      let t = 0;
      for (let r = r0; r <= r1; r += 1) t += heights[r] + (extra.get(r) ?? 0);
      if (t >= v - 1e-6) continue;
      const variable: number[] = [];
      for (let r = r0; r <= r1; r += 1) if (given[r] === null) variable.push(r);
      if (!variable.length) continue;
      const add = (v - t) / variable.length;
      for (const r of variable) extra.set(r, (extra.get(r) ?? 0) + add);
    }
    for (const [r, v] of extra) heights[r] += v;
    return heights;
  }

  wrap(c: Canvas): { w: number; h: number } {
    this.heights = this.computeHeights(c);
    return { w: this.colWidths.reduce((a, b) => a + b, 0), h: this.heights.reduce((a, b) => a + b, 0) };
  }

  /** 전체 높이 */
  height(c: Canvas): number {
    return this.wrap(c).h;
  }

  draw(c: Canvas, x: number, top: number): void {
    const heights = this.heights ?? this.computeHeights(c);
    const rowTop: number[] = [];
    let y = top;
    for (const h of heights) {
      rowTop.push(y);
      y += h;
    }
    const colX = this.colWidths.map((_, i) => x + this.colPos(i));
    const rectOf = (col: number, r: number) => {
      const span = this.spanAt.get(`${col},${r}`);
      const c1 = span ? span.c1 : col;
      const r1 = span ? span.r1 : r;
      const w = colX[c1] + this.colWidths[c1] - colX[col];
      const h = rowTop[r1] + heights[r1] - rowTop[r];
      return { x: colX[col], y: rowTop[r], w, h };
    };
    const doc = c.doc;

    // 배경
    for (const { range, color } of this.opts.backgrounds ?? []) {
      const [c0, r0, c1, r1] = this.norm(range);
      if (r0 >= this.nRows || c0 >= this.nCols) continue;
      const rr1 = Math.min(r1, this.nRows - 1);
      const cc1 = Math.min(c1, this.nCols - 1);
      const bx = colX[c0];
      const by = rowTop[r0];
      const bw = colX[cc1] + this.colWidths[cc1] - bx;
      const bh = rowTop[rr1] + heights[rr1] - by;
      doc.save().rect(bx, by, bw, bh).fill(color).restore();
    }

    // 내용
    const valign = this.opts.valign ?? "BOTTOM";
    const align = this.opts.align ?? "LEFT";
    for (let r = 0; r < this.nRows; r += 1) {
      for (let col = 0; col < this.nCols; col += 1) {
        if (this.hidden.has(`${col},${r}`)) continue;
        const cell = this.rows[r][col] ?? null;
        if (cell === null) continue;
        const pad = this.pads[r][col];
        const rect = rectOf(col, r);
        const size = cell.wrap(c, rect.w - pad.left - pad.right);
        let cy: number;
        if (valign === "TOP") cy = rect.y + pad.top;
        else if (valign === "BOTTOM") cy = rect.y + rect.h - pad.bottom - size.h;
        else cy = rect.y + (rect.h - pad.bottom + pad.top - size.h) / 2;
        let cx: number;
        if (align === "LEFT") cx = rect.x + pad.left;
        else if (align === "RIGHT") cx = rect.x + rect.w - pad.right - size.w;
        else cx = rect.x + (rect.w + pad.left - pad.right - size.w) / 2;
        cell.draw(c, cx, cy);
      }
    }

    // 격자 (병합 칸은 바깥 테두리만)
    if (this.opts.grid) {
      doc.save().lineWidth(this.opts.grid).strokeColor("#000000");
      const seen = new Set<string>();
      const seg = (x1: number, y1: number, x2: number, y2: number) => {
        const k = `${x1.toFixed(3)},${y1.toFixed(3)},${x2.toFixed(3)},${y2.toFixed(3)}`;
        if (seen.has(k)) return;
        seen.add(k);
        doc.moveTo(x1, y1).lineTo(x2, y2);
      };
      for (let r = 0; r < this.nRows; r += 1) {
        for (let col = 0; col < this.nCols; col += 1) {
          if (this.hidden.has(`${col},${r}`)) continue;
          const { x: rx, y: ry, w, h } = rectOf(col, r);
          seg(rx, ry, rx + w, ry);
          seg(rx, ry + h, rx + w, ry + h);
          seg(rx, ry, rx, ry + h);
          seg(rx + w, ry, rx + w, ry + h);
        }
      }
      doc.stroke().restore();
    }
  }
}
