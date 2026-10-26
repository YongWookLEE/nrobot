// 서버 전용: 견적서 PDF (spec 12절). 기존 pdf_quote.py 의 배치를 그대로 옮긴다.
import path from "node:path";
import PDFDocument from "pdfkit";
import baseLayout from "../../../assets/layout/base_layout.json";
import { calculate, lineAmount } from "@/domain/calculate";
import { categoryGroups, categorySpans, formatItemNote, koreanAmount, money, qtyText } from "@/domain/format";
import { isCatalogType, type CatalogTemplate, type CellStyle, type QuoteInput } from "@/domain/types";
import { pdfFontFiles } from "../fonts";
import { Canvas, Para, Picture, Spacer, Table, type CellRange, type Flow, type ParaStyle, type TableOptions } from "./layout";

/** reportlab A4 (210mm × 297mm) */
export const A4_WIDTH = 595.2755905511812;
export const A4_HEIGHT = 841.8897637795277;

/** 프로젝트 폴더 기준 PDF 그림 파일 (로고). 배포 번들에 포함해야 한다. */
export const PDF_ASSET_FILES = {
  logo33: "assets/images/Image33.png",
  logo35: "assets/images/Image35.png",
  logo37: "assets/images/Image37.jpg",
} as const;

export const PDF_AUTHOR = "주식회사 앤로보틱스";

/** ④⑤ 한 페이지 최대 품목 수 */
export const CATALOG_ITEMS_PER_PAGE = 4;

export interface PdfImage {
  data: Buffer;
  ext: string;
}

export interface PdfDeps {
  /** 가격표 사진 (없는 id 는 null) */
  getImage(id: string): PdfImage | null;
  /** 글꼴·로고를 찾을 프로젝트 폴더 (기본 process.cwd()) */
  root?: string;
}

export interface PdfResult {
  buffer: Buffer;
  pages: number;
  /** 전체 축소 비율 (1 이면 축소 없음) */
  scale: number;
  total: number;
}

const W = A4_WIDTH - 36;
const YELLOW = "#ffff00";
const LABEL_BG = "#f2f2f2";
const BLACK = "#000000";

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** "YYYY-MM-DD" → "YYYY년 M월 D일" */
function koreanDate(date: string): string {
  const [y, m, d] = date.split("-").map((v) => Number(v));
  return `${y}년 ${m}월 ${d}일`;
}

/** 진행 중 문서를 Buffer 로 모은다 */
function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/**
 * 견적서 PDF 를 만들고 페이지 수·축소 비율도 돌려준다.
 * 금액은 domain calculate/lineAmount 결과만 쓴다.
 */
export async function renderQuotePdfWithInfo(quote: QuoteInput, deps: PdfDeps): Promise<PdfResult> {
  const root = deps.root ?? process.cwd();
  const kind = quote.quoteType;
  const product = isCatalogType(kind);
  const cost = kind === "cost";
  const fonts = pdfFontFiles(kind, root);

  const doc = new PDFDocument({
    size: [A4_WIDTH, A4_HEIGHT],
    margin: 0,
    autoFirstPage: false,
    font: fonts.regular,
    info: { Title: quote.title, Author: PDF_AUTHOR },
  });
  const done = collect(doc);
  doc.registerFont("Q-regular", fonts.regular);
  doc.registerFont("Q-bold", fonts.bold);
  const canvas = new Canvas(doc, { regular: "Q-regular", bold: "Q-bold" });

  // 기본 서식 (④⑤는 굵은 자리도 같은 Medium 글꼴)
  const normal: ParaStyle = { font: "regular", size: 7.4, leading: 10, align: 0, color: BLACK };
  const bold: ParaStyle = { ...normal, font: "bold" };
  const styles = { normal, bold, center: { ...normal, align: 1 as const }, bc: { ...bold, align: 1 as const }, right: { ...normal, align: 2 as const }, br: { ...bold, align: 2 as const } };
  const p = (text: string | number, style: ParaStyle = styles.normal) => new Para(String(text), style);

  // 열 너비
  const ratios = [6, 17.09765625, 38.09765625, 7.69921875, 10.19921875, 17.19921875, 18.09765625, 18.5];
  let widths = ratios.map((x) => (W * x) / sum(ratios));
  if (cost) widths = [37, 105, 206, 47, 45, 58, 59, 58, 84, 95].map((x) => (W * x) / 794);
  const template: CatalogTemplate | undefined = product ? quote.items.find((i) => i.template)?.template : undefined;
  let sourceScale = 1;
  if (!product && !cost) {
    sourceScale = W / sum(baseLayout.columns);
    widths = baseLayout.columns.map((v) => v * sourceScale);
  }
  if (template) {
    const cols = template.columns;
    sourceScale = W / sum(cols);
    widths = [cols[0], cols[1], sum(cols.slice(2, 5)), ...cols.slice(5, 10)].map((v) => v * sourceScale);
  }
  if (!product) {
    const baseFont = baseLayout.fontSize * (W / sum(baseLayout.columns));
    for (const st of Object.values(styles)) {
      st.size = baseFont;
      st.leading = baseFont * 1.25;
    }
  }

  /** 가격표 셀 서식 그대로 (기존 styled) */
  const styled = (text: string | number, meta: CellStyle & { size?: number }, align?: 0 | 1 | 2) => {
    const size = Math.max(5, (meta.size ?? 11) * sourceScale);
    const metaAlign = meta.align === "center" ? 1 : meta.align === "right" ? 2 : 0;
    const style: ParaStyle = {
      font: product ? "regular" : meta.bold ? "bold" : "regular",
      size,
      leading: size * 1.18,
      color: meta.color || BLACK,
      align: align ?? metaAlign,
    };
    return p(text, style);
  };

  const xLeft = sum(widths.slice(0, 2));
  const xMid = sum(widths.slice(0, 3));
  const xMoney = sum(widths.slice(0, 5));
  const cellPad = product ? 1 : 2;
  const grid = (extra: Partial<TableOptions> = {}): Omit<TableOptions, "colWidths"> => ({
    grid: 0.5,
    valign: "MIDDLE",
    padding: { left: cellPad, right: cellPad, top: 1, bottom: 1 },
    ...extra,
  });
  const table = (rows: Array<Array<Flow | null>>, colWidths: number[], rowHeights: Array<number | null> | null, extra: Partial<TableOptions> = {}) =>
    new Table(rows, { colWidths, rowHeights, ...grid(extra) });

  const { subtotal, tax, total } = calculate(quote.items, kind);

  // 상단: 왼쪽 표
  const leftRows: Array<[string, string]> = [
    ["견적번호 :", quote.number],
    ["수     신 :", quote.customer],
    ["참     조 :", quote.contact],
    ["작성일자 :", koreanDate(quote.date)],
    ["TEL. :", quote.phone],
    ["FAX. :", quote.email],
  ];
  const left = table(
    leftRows.map(([a, b]) => [p(a, styles.bc), p(b, styles.bold)]),
    [xLeft, xMid - xLeft - 16],
    null,
    { backgrounds: [{ range: [0, 0, 0, -1], color: LABEL_BG }] },
  );
  // 상단: 공급자 표
  const rw = W - xMid;
  const rightRows: Array<Array<Flow | null>> = [
    [p("상 호", styles.bc), p("주식회사 앤로보틱스", styles.bc), p("대표", styles.bc), p("김종서 [직인생략]", styles.bc)],
    [p("사업자번호", styles.bc), p("140-81-01965", styles.bold), null, null],
    [p("주소", styles.bc), p("경기도 안양시 동안구 시민대로 109번길 11, 앤로보틱스\n(안양사업장)", styles.bold), null, null],
    [p("연락처", styles.bc), p("Tel. 031-429-0050, Fax. 031-429-0030", styles.bold), null, null],
    [p("담당자", styles.bc), p(quote.staffDisplay, styles.bc), p("H.P", styles.bc), p(quote.staffPhone, styles.bc)],
  ];
  const rws = [xMoney - xMid, rw * 0.43, rw * 0.1, 0];
  rws[3] = rw - sum(rws.slice(0, 3));
  if (!product && rws[3] < 85) {
    rws[1] -= 85 - rws[3];
    rws[3] = 85;
  }
  const supplier = table(rightRows, rws, null, {
    spans: [1, 2, 3].map((i): CellRange => [1, i, 3, i]),
    backgrounds: [{ range: [0, 0, 0, -1], color: LABEL_BG }],
  });
  const header = new Table([[left, null, supplier]], {
    colWidths: [xMid - 16, 16, rw],
    valign: "TOP",
    padding: { left: 0, right: 0, top: 0, bottom: 0 },
  });
  const titleStyle: ParaStyle = { ...styles.bold, size: 24, leading: 32, align: 1 };
  const nb = " ".repeat(7);
  const story: Flow[] = [
    p(`견${nb}적${nb}서`, titleStyle),
    new Spacer(46),
    header,
    new Spacer(10),
    p("아래와 같이 견적서를 제출합니다", styles.bold),
    new Spacer(10),
    p(`품 명 : "${quote.title}"`, styles.bold),
    new Spacer(7),
  ];

  // 특기사항·금액 표
  const amountText = product ? `${money(total)}원` : `₩${money(total)}`;
  const termsBg = [
    { range: [0, 0, 0, 2] as CellRange, color: LABEL_BG },
    { range: [2, 0, 2, 2] as CellRange, color: LABEL_BG },
  ];
  let terms: Table;
  if (product) {
    const feeWidth = widths[widths.length - 1];
    terms = table(
      [
        [
          p("특기   사항", styles.bc),
          p(quote.validity, styles.bold),
          p("금액", styles.bc),
          p(`일금${koreanAmount(total)}원정`, styles.bold),
          p(quote.showFee ? "조달수수료(0.54%) 별도" : "", { ...styles.bc, size: 6.4, leading: 9 }),
        ],
        [null, p(quote.delivery, styles.bold), null, p(amountText, styles.bold), null],
        [null, p(quote.payment, styles.bold), null, p("V.A.T.(부가가치세) 포함", styles.bold), null],
      ],
      [xLeft, xMid - xLeft, xMoney - xMid, W - xMoney - feeWidth, feeWidth],
      null,
      { spans: [[0, 0, 0, 2], [2, 0, 2, 2], [4, 0, 4, 2]], backgrounds: termsBg },
    );
  } else {
    terms = table(
      [
        [p("특기   사항", styles.bc), p(quote.validity, styles.bold), p("금액", styles.bc), p(`일금${koreanAmount(total)}원정`, styles.bold)],
        [null, p(quote.delivery, styles.bold), null, p(amountText, styles.bold)],
        [null, p(quote.payment, styles.bold), null, p(kind === "total" ? "V.A.T.(부가가치세) 미포함" : "V.A.T.(부가가치세) 포함", styles.bold)],
      ],
      [xLeft, xMid - xLeft, xMoney - xMid, W - xMoney],
      null,
      { spans: [[0, 0, 0, 2], [2, 0, 2, 2]], backgrounds: termsBg },
    );
  }
  story.push(terms, new Spacer(5));

  // 품목 표
  const heads = ["순번", "구분", "품목", "단위", "수량", ...(cost ? ["재료비", "노무비", "경비"] : ["단가"]), "합계", "비고"];
  const merged = quote.mergeCategories;
  const groupNumbers = categoryGroups(quote.items, merged);
  const rows: Array<Array<Flow | null>> = [heads.map((t) => (template ? styled(t, template.header, 1) : p(t, styles.bc)))];
  let height = 28;
  let itemHeights: number[] = [];
  const noteWidth = widths[widths.length - 1];
  const imageCache = new Map<string, { image: unknown; width: number; height: number } | null>();
  const openImage = (id: string) => {
    if (imageCache.has(id)) return imageCache.get(id) ?? null;
    const blob = deps.getImage(id);
    let opened: { image: unknown; width: number; height: number } | null = null;
    if (blob) {
      const image = doc.openImage(blob.data) as unknown as { width: number; height: number };
      opened = { image, width: image.width, height: image.height };
    }
    imageCache.set(id, opened);
    return opened;
  };

  /** Table 은 wrap 폭을 무시하고, 문단은 폭-4 로 잰다 (기존 measured 계산) */
  const measureHeight = (cell: Flow | null, w: number): number => {
    if (cell === null) return 0;
    if (cell instanceof Para) return cell.measure(canvas, w - 4);
    return cell.wrap(canvas, w - 4).h;
  };

  quote.items.forEach((item, index) => {
    const amount = lineAmount(item, kind);
    const group = groupNumbers[index];
    let cells: Array<Flow | null> = [p(group, styles.center), p(item.category, styles.center), p(item.name), p(item.unit, styles.center), p(qtyText(item.qty), styles.center)];
    const moneyKeys = cost ? (["material", "labor", "expense"] as const) : (["price"] as const);
    for (const k of moneyKeys) cells.push(p(money(item[k] ?? 0), styles.right));
    const itemTemplate = product ? item.template : undefined;
    if (itemTemplate) {
      const meta = itemTemplate.cells;
      cells = [
        styled(group, meta.A, 1),
        styled(item.category, meta.B, 1),
        p(item.name),
        styled(item.unit, meta.F, 1),
        styled(qtyText(item.qty), meta.G, 1),
        styled(money(item.price), meta.H, 2),
      ];
      if (itemTemplate.lines.length) {
        const lineRows: Array<Array<Flow | null>> = [];
        const lineHeights: number[] = [];
        const lineBg: Array<{ range: CellRange; color: string }> = [];
        itemTemplate.lines.forEach((line, n) => {
          const value = styled(line.text, line);
          const h = Math.max(line.height * sourceScale, value.measure(canvas, widths[2] - 4) + 2);
          lineRows.push([value]);
          lineHeights.push(h);
          lineBg.push({ range: [0, n, 0, n], color: line.fill });
        });
        cells[2] = new Table(lineRows, {
          colWidths: [widths[2] - 4],
          rowHeights: lineHeights,
          backgrounds: lineBg,
          padding: { left: 0, right: 0, top: 0, bottom: 0 },
        });
      }
    }
    const noteText = formatItemNote(item.note);
    let note: Flow = p(noteText);
    for (const noteSize of [7.4, 7, 6.6, 6.2]) {
      const noteStyle: ParaStyle = { ...(product ? styles.center : styles.normal), size: noteSize, leading: noteSize + 2 };
      const candidate = p(noteText, noteStyle);
      note = candidate;
      if (candidate.measure(canvas, noteWidth - 4) <= 2 * noteStyle.leading + 0.1) break;
    }
    if (itemTemplate) note = styled(noteText, itemTemplate.cells.J, 1);
    if (product && item.imageIds && item.imageIds.length) {
      const parts: Array<Array<Flow | null>> = [[note]];
      for (const id of item.imageIds) {
        const opened = openImage(id);
        if (!opened) continue;
        const pic = new Picture(opened.image, opened.width, opened.height);
        const dimensions = itemTemplate ? itemTemplate.imageSizes[id] : undefined;
        if (dimensions) {
          pic.drawWidth = dimensions[0] * sourceScale;
          pic.drawHeight = dimensions[1] * sourceScale;
          if (pic.drawWidth > noteWidth - 8) {
            const factor = (noteWidth - 8) / pic.drawWidth;
            pic.drawWidth *= factor;
            pic.drawHeight *= factor;
          }
        } else {
          pic.restrictSize(noteWidth - 8, 90);
        }
        parts.push([pic]);
      }
      note = new Table(parts, { colWidths: [noteWidth - 4], align: "CENTER", padding: { left: 0, right: 0 } });
    }
    cells.push(itemTemplate ? styled(money(amount), itemTemplate.cells.I, 2) : p(money(amount), styles.br), note);
    const measured = Math.max(...cells.map((c, i) => measureHeight(c, widths[i]) + 4));
    const rowHeight = itemTemplate ? Math.max(itemTemplate.height * sourceScale, measured) : Math.max(28, measured + 6);
    itemHeights.push(rowHeight);
    height = Math.max(height, rowHeight);
    rows.push(cells);
  });
  const filledCount = quote.items.length;
  if (quote.blankRows) {
    const last = groupNumbers[groupNumbers.length - 1];
    for (let i = 0; i < 2; i += 1) rows.push([p(last + i + 1, styles.center), ...heads.slice(1).map(() => null)]);
  }
  if (!product) itemHeights = itemHeights.map(() => height);
  const headerHeight = template ? template.headerHeight * sourceScale : 20;
  const bodyStyle = (items: typeof quote.items): Partial<TableOptions> => ({
    backgrounds: [
      { range: [0, 0, -1, 0], color: LABEL_BG },
      { range: [2, 1, 2, -1], color: product ? "#ffffff" : "#eeece1" },
    ],
    spans: categorySpans(items, merged).flatMap(([s, e]): CellRange[] => [
      [0, s + 1, 0, e + 1],
      [1, s + 1, 1, e + 1],
    ]),
  });
  const blankCount = rows.length - 1 - filledCount;
  const body = table(rows, widths, [headerHeight, ...itemHeights, ...Array<number>(blankCount).fill(16)], bodyStyle(quote.items));

  // 합계 표
  let summary: Array<[string, number]> = kind === "vat" || kind === "cost" ? [["합 계", subtotal], ["부 가 세", tax], ["견 적 가", total]] : [["견 적 가", total]];
  let summaryRow = summary.length - 1;
  let notesText = quote.notes;
  if (product) {
    summary = [["합 계", total]];
    summaryRow = 0;
    notesText = notesText.replace(/조달수수료\(0\.54%\) 총계 포함/g, "조달수수료(0.54%) 별도").replace(/조달수수료\(0\.54%\) 합계 포함/g, "조달수수료(0.54%) 별도");
  }
  const summaryTable = table(
    summary.map(([label, value]) => [p(label, styles.bc), p(money(value), styles.br), null]),
    [sum(widths.slice(0, -2)), widths[widths.length - 2], widths[widths.length - 1]],
    summary.map(() => (product ? Math.max(14, 18 * sourceScale) : 24)),
    { backgrounds: [{ range: [0, summaryRow, -1, summaryRow], color: YELLOW }] },
  );
  if (product && !quote.showFee) {
    notesText = notesText
      .split(/\r\n|\r|\n/)
      .filter((line) => !line.includes("조달수수료"))
      .join("\n");
  }
  const notes = table([[p("* NOTE", styles.bold)], [p(notesText)]], [W], null, {
    backgrounds: [{ range: [0, 0, -1, 0], color: "#bfbfbf" }],
    paddingRanges: [{ range: [0, 1, -1, 1], padding: { top: 5, bottom: 12 } }],
  });
  story.push(body, summaryTable, new Spacer(10), notes);

  // 페이지 나누기: ④⑤는 품목 경계에서 4개씩, 나머지는 1페이지
  let pageStories: Flow[][] = [story];
  if (product && filledCount > CATALOG_ITEMS_PER_PAGE) {
    pageStories = [];
    const head = story.slice(0, -4);
    for (let offset = 0; offset < filledCount; offset += CATALOG_ITEMS_PER_PAGE) {
      const isLast = offset + CATALOG_ITEMS_PER_PAGE >= filledCount;
      const end = Math.min(offset + CATALOG_ITEMS_PER_PAGE, filledCount);
      const pageRows = [rows[0], ...rows.slice(1 + offset, 1 + end)];
      const count = pageRows.length - 1;
      const blanks = isLast ? rows.slice(1 + filledCount) : [];
      pageRows.push(...blanks);
      const pageBody = table(
        pageRows,
        widths,
        [headerHeight, ...itemHeights.slice(offset, offset + count), ...blanks.map(() => 16)],
        bodyStyle(quote.items.slice(offset, offset + CATALOG_ITEMS_PER_PAGE)),
      );
      pageStories.push([...(offset === 0 ? head : []), pageBody, ...(isLast ? [summaryTable, new Spacer(10), notes] : [])]);
    }
  }

  const measuredPages = pageStories.map((page) => page.map((flow) => ({ flow, h: flow.wrap(canvas, W).h })));
  const available = A4_HEIGHT - 78;
  const scale = Math.min(1, available / Math.max(...measuredPages.map((page) => sum(page.map((f) => f.h)))));

  const logos: Array<[string, number, number, number, number]> = [
    [PDF_ASSET_FILES.logo33, W - 117, -76, 24, 29],
    [PDF_ASSET_FILES.logo35, W - 93, -76, 24, 29],
    [PDF_ASSET_FILES.logo37, W - 69, -76, 64, 13],
  ];
  const footerStyle: ParaStyle = { ...normal, font: "regular", size: 8, leading: 8 };
  const totalPages = measuredPages.length;
  measuredPages.forEach((page, idx) => {
    doc.addPage({ size: [A4_WIDTH, A4_HEIGHT], margin: 0 });
    doc.save();
    doc.translate((A4_WIDTH - W * scale) / 2, 48);
    doc.scale(scale);
    let y = 0;
    for (const { flow, h } of page) {
      // 다시 wrap: 같은 표 객체를 여러 페이지가 함께 쓰므로 그리기 직전에 맞춘다
      flow.wrap(canvas, W);
      flow.draw(canvas, 0, y);
      y += h;
    }
    if (idx === 0) {
      for (const [file, x, by, w, h] of logos) {
        // 기존 좌표는 아래에서 위로 잰 그림 아래쪽(by). 위쪽 = -(by + h)
        doc.image(path.join(root, file), x, -(by + h), { width: w, height: h });
      }
    }
    doc.restore();
    if (product) {
      const label = `${idx + 1} / ${totalPages}`;
      const width = canvas.charWidth("regular", 8);
      const textWidth = sum(Array.from(label).map(width));
      canvas.drawText(label, A4_WIDTH / 2 - textWidth / 2, A4_HEIGHT - 16, footerStyle);
    }
  });
  doc.end();
  const buffer = await done;
  return { buffer, pages: totalPages, scale, total };
}

/** 견적서 PDF 바이트 */
export async function renderQuotePdf(quote: QuoteInput, deps: PdfDeps): Promise<Buffer> {
  return (await renderQuotePdfWithInfo(quote, deps)).buffer;
}
