// 편집 가능한 견적서 xlsx (spec 13절 — 기존 xlsx_quote.py write_xlsx 이식, ExcelJS 사용).
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import type { QuoteInput } from "@/domain";
import { isPng } from "./imageSize";
import { colName, makePages, type Edges, type ImageData, type LayoutCell, type Page } from "./layout";

export { makePages } from "./layout";

export interface XlsxDeps {
  /** 제품 사진. 없는 id면 null */
  getImage(id: string): { data: Buffer; ext: string } | null;
}

const LOGO_FILES = ["Image33.png", "Image35.png", "Image37.jpg"];
let logoCache: ImageData[] | null = null;

function loadLogos(): ImageData[] {
  logoCache ??= LOGO_FILES.map((name) => ({
    data: readFileSync(path.join(process.cwd(), "assets", "images", name)),
    ext: name.endsWith(".png") ? "png" : "jpg",
  }));
  return logoCache;
}

const NO_EDGES: Edges = [false, false, false, false];
const ALL_EDGES: Edges = [true, true, true, true];
const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF000000" } };

function argb(hex: string): string {
  return "FF" + hex.replace(/^#/, "").toUpperCase();
}

function cellStyle(c: LayoutCell, edges: Edges): Partial<ExcelJS.Style> {
  const align = c.align === "center" || c.align === "left" || c.align === "right" ? c.align : "left";
  const fmt = c.fmt ?? (typeof c.value === "number" ? 3 : 0);
  const font: Partial<ExcelJS.Font> = { name: c.font, size: c.size, color: { argb: argb(c.color) } };
  if (c.bold) font.bold = true;
  const border: Partial<ExcelJS.Borders> = {};
  if (edges[0]) border.left = THIN;
  if (edges[1]) border.right = THIN;
  if (edges[2]) border.top = THIN;
  if (edges[3]) border.bottom = THIN;
  const style: Partial<ExcelJS.Style> = {
    font,
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: argb(c.fill) }, bgColor: { indexed: 64 } as unknown as ExcelJS.Color },
    border,
    alignment: { horizontal: align, vertical: c.valign === "top" ? "top" : "middle", wrapText: true },
  };
  if (fmt === 3) style.numFmt = "#,##0";
  return style;
}

/** 기존 열 너비 환산: pt → px → Excel 글자 폭 */
function columnWidth(pt: number): number {
  const px = pt / 0.75;
  const cw = px >= 12 ? (px - 5) / 7 : px / 12;
  return Math.max(0.01, cw);
}

function writeSheet(wb: ExcelJS.Workbook, page: Page, index: number, count: number): void {
  const lastCol = page.xs.length - 1;
  const lastRow = page.ys.length - 1;
  const ws = wb.addWorksheet(page.name, {
    properties: { defaultRowHeight: 15 },
    views: [{ showGridLines: false, zoomScale: 85 }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.1, footer: 0.1 },
      printArea: `A1:${colName(lastCol)}${lastRow}`,
    },
  });
  if (count > 1) ws.headerFooter.oddFooter = `${index} / ${count}`;
  for (let i = 1; i <= lastCol; i++) ws.getColumn(i).width = columnWidth(page.xs[i] - page.xs[i - 1]);
  for (let i = 1; i <= lastRow; i++) ws.getRow(i).height = Math.max(0.01, page.ys[i] - page.ys[i - 1]);

  const used = new Set<string>();
  for (const c of page.cells) {
    for (let rr = c.r; rr <= c.r2; rr++) {
      for (let cc = c.c; cc <= c.c2; cc++) {
        const key = `${rr},${cc}`;
        if (used.has(key)) throw new Error("Excel 셀 배치가 겹칩니다.");
        used.add(key);
      }
    }
    if (c.r !== c.r2 || c.c !== c.c2) ws.mergeCells(c.r, c.c, c.r2, c.c2);
  }
  // 병합 뒤에 칸마다 새 서식 객체를 넣는다 (병합 칸은 서식 객체를 공유하므로).
  for (const c of page.cells) {
    const edges = c.edges ?? (c.border ? ALL_EDGES : NO_EDGES);
    for (let rr = c.r; rr <= c.r2; rr++) {
      for (let cc = c.c; cc <= c.c2; cc++) {
        const master = rr === c.r && cc === c.c;
        const ed: Edges = master
          ? edges
          : [edges[0] && cc === c.c, edges[1] && cc === c.c2, edges[2] && rr === c.r, edges[3] && rr === c.r2];
        ws.getCell(rr, cc).style = cellStyle(c, ed);
      }
    }
    const target = ws.getCell(c.r, c.c);
    if (c.formula) {
      target.value = { formula: c.formula(), result: c.value } as ExcelJS.CellFormulaValue;
    } else if (c.value !== "") {
      // 사용자 입력은 언제나 값으로만 넣는다 ('=1+1'도 문자).
      target.value = c.value;
    }
  }

  for (const img of page.images) {
    const extension = img.ext === "png" || isPng(img.data) ? "png" : "jpeg";
    const id = wb.addImage({ buffer: img.data as unknown as ExcelJS.Buffer, extension });
    let col = 0;
    let row = 0;
    page.xs.forEach((v, k) => {
      if (v <= img.x) col = k;
    });
    page.ys.forEach((v, k) => {
      if (v <= img.y) row = k;
    });
    ws.addImage(id, {
      tl: {
        nativeCol: col,
        nativeColOff: Math.round((img.x - page.xs[col]) * 12700),
        nativeRow: row,
        nativeRowOff: Math.round((img.y - page.ys[row]) * 12700),
      } as unknown as ExcelJS.Anchor,
      ext: { width: img.w / 0.75, height: img.h / 0.75 },
    });
  }
}

/** 견적 → xlsx 바이트. 금액은 src/domain 계산 결과를 계산값으로 함께 기록한다. */
export async function renderQuoteXlsx(quote: QuoteInput, deps: XlsxDeps): Promise<Buffer> {
  const { pages } = makePages(quote, { getImage: (id) => deps.getImage(id), logos: loadLogos() });
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  pages.forEach((page, i) => writeSheet(wb, page, i + 1, pages.length));
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
