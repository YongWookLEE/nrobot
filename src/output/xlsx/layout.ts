// 기존 xlsx_quote.py make_pages() 이식: 점(pt) 단위 사각형으로 셀을 배치한다.
// 칸 경계(xs·ys)를 모아 Excel 열·행으로 바꾸고, 여러 칸에 걸친 사각형은 병합 셀이 된다.
import baseLayout from "../../../assets/layout/base_layout.json";
import { calculate, categoryGroups, formatItemNote, isCatalogType, lineAmount, money } from "@/domain";
import type { CatalogTemplate, QuoteInput, QuoteItem } from "@/domain";
import { imagePixelSize } from "./imageSize";
import { fsum, round2, splitLines, textHeight } from "./pymath";

export type Edges = [left: boolean, right: boolean, top: boolean, bottom: boolean];

export interface ImageData {
  data: Buffer;
  ext: string;
}

export interface LayoutCell {
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | number;
  font: string;
  size: number;
  bold: boolean;
  color: string;
  fill: string;
  align: string;
  valign: "center" | "top";
  border: boolean;
  edges?: Edges;
  /** 0 = 일반, 3 = #,##0. 없으면 숫자 값은 3, 문자는 0 */
  fmt?: 0 | 3;
  /** 시트 배치가 끝난 뒤(셀 주소가 정해진 뒤) 수식 문자열을 만든다. value는 계산값으로 함께 기록한다. */
  formula?: () => string;
  /** 수식 역할 (검사·디버깅용) */
  role?: "line" | "summary" | "topText" | "topValue";
  // prepare() 결과 (1부터 세는 열·행)
  c: number;
  r: number;
  c2: number;
  r2: number;
  ref: string;
}

export interface LayoutImage {
  data: Buffer;
  ext: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 1 → A */
export function colName(n: number): string {
  let out = "";
  while (n) {
    const r = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    out = String.fromCharCode(65 + r) + out;
  }
  return out;
}

type CellInput = Partial<Omit<LayoutCell, "x" | "y" | "w" | "h" | "value" | "c" | "r" | "c2" | "r2" | "ref">>;

export class Page {
  readonly cells: LayoutCell[] = [];
  readonly images: LayoutImage[] = [];
  xs: number[] = [];
  ys: number[] = [];

  constructor(readonly name: string) {}

  cell(x: number, y: number, w: number, h: number, value: string | number, style: CellInput): LayoutCell {
    const c: LayoutCell = {
      x,
      y,
      w,
      h,
      value,
      font: style.font ?? "맑은 고딕",
      size: style.size ?? 11,
      bold: style.bold ?? false,
      color: style.color ?? "#000000",
      fill: style.fill ?? "#ffffff",
      align: style.align ?? "left",
      valign: style.valign ?? "center",
      border: style.border ?? true,
      c: 0,
      r: 0,
      c2: 0,
      r2: 0,
      ref: "",
    };
    if (style.edges) c.edges = style.edges;
    if (style.fmt !== undefined) c.fmt = style.fmt;
    this.cells.push(c);
    return c;
  }

  image(img: ImageData, x: number, y: number, w: number, h: number): void {
    this.images.push({ data: img.data, ext: img.ext, x, y, w, h });
  }

  /** 칸 경계를 모아 열·행 번호를 정한다. */
  prepare(): void {
    const xs = new Set<number>([0]);
    const ys = new Set<number>([0]);
    for (const c of this.cells) {
      xs.add(round2(c.x));
      xs.add(round2(c.x + c.w));
      ys.add(round2(c.y));
      ys.add(round2(c.y + c.h));
    }
    const sortedYs = [...ys].sort((a, b) => a - b);
    // Excel 행 높이 한도 때문에 400pt를 넘는 간격은 셀을 자르지 않고 행만 나눈다.
    for (let i = 0; i + 1 < sortedYs.length; i++) {
      const a = sortedYs[i];
      const b = sortedYs[i + 1];
      if (b - a > 400) for (let k = 1; k < Math.ceil((b - a) / 400); k++) ys.add(round2(a + k * 400));
    }
    this.xs = [...xs].sort((a, b) => a - b);
    this.ys = [...ys].sort((a, b) => a - b);
    for (const c of this.cells) {
      c.c = this.xs.indexOf(round2(c.x)) + 1;
      c.r = this.ys.indexOf(round2(c.y)) + 1;
      c.c2 = this.xs.indexOf(round2(c.x + c.w));
      c.r2 = this.ys.indexOf(round2(c.y + c.h));
      c.ref = `'${this.name}'!${colName(c.c)}${c.r}`;
    }
  }
}

export interface LayoutDeps {
  getImage(id: string): ImageData | null;
  /** 상단 로고 3개 (Image33.png, Image35.png, Image37.jpg 순서) */
  logos: readonly ImageData[];
}

export interface LayoutResult {
  pages: Page[];
  total: number;
}

const SUPPLIER = {
  name: "주식회사 앤로보틱스",
  ceo: "김종서 [직인생략]",
  bizNo: "140-81-01965",
  address: "경기도 안양시 동안구 시민대로 109번길 11, 앤로보틱스\n(안양사업장)",
  contact: "Tel. 031-429-0050, Fax. 031-429-0030",
};

const FEE_INCLUDED = ["조달수수료(0.54%) 총계 포함", "조달수수료(0.54%) 합계 포함"];
const FEE_SEPARATE = "조달수수료(0.54%) 별도";

function replaceAll(s: string, from: string, to: string): string {
  return s.split(from).join(to);
}

function dateText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function makePages(quote: QuoteInput, deps: LayoutDeps): LayoutResult {
  const kind = quote.quoteType;
  const product = isCatalogType(kind);
  const cost = kind === "cost";
  const { subtotal, tax, total } = calculate(quote.items, kind);
  const W = 790.0;
  const template: CatalogTemplate | undefined = product ? quote.items.find((i) => i.template)?.template : undefined;
  let raw: number[] = baseLayout.columns;
  if (cost) raw = [37, 105, 206, 47, 45, 58, 59, 58, 84, 95];
  if (template) {
    const cc = template.columns;
    raw = [cc[0], cc[1], fsum(cc.slice(2, 5)), ...cc.slice(5, 10)];
  }
  const scale = W / fsum(raw);
  const widths = raw.map((v) => v * scale);
  const edges = widths.map((_, i) => fsum(widths.slice(0, i))).concat([fsum(widths)]);
  const last = widths.length - 1;
  const nums = categoryGroups(quote.items, quote.mergeCategories);
  const pages: Page[] = [];
  const amountCells: LayoutCell[] = [];
  const topAmounts: Array<[LayoutCell, number]> = [];
  const chunks: QuoteItem[][] = [];
  if (product) for (let i = 0; i < quote.items.length; i += 4) chunks.push(quote.items.slice(i, i + 4));
  else chunks.push(quote.items);
  const font = product ? "KoPub돋움체 Medium" : "맑은 고딕";
  const meta = (m: CatalogTemplate["lines"][number]): CellInput => ({
    font: m.font ?? font,
    size: (m.size ?? 11) * scale,
    bold: m.bold ?? false,
    color: m.color ?? "#000000",
    fill: m.fill ?? "#ffffff",
    align: m.align ?? "left",
  });

  chunks.forEach((items, pi) => {
    const page = new Page(pi === 0 ? "견적서" : `견적서_${pi + 1}`);
    pages.push(page);
    let y = 0;
    const cell = (x: number, yy: number, w: number, h: number, v: string | number = "", kw: CellInput = {}) =>
      page.cell(x, yy, w, h, v, { ...kw, font: kw.font ?? font });
    const row = (vals: Array<string | number>, ws: number[], h: number, kw: CellInput = {}): LayoutCell[] => {
      let x = 0;
      const out: LayoutCell[] = [];
      vals.forEach((v, i) => {
        out.push(cell(x, y, ws[i], h, v, kw));
        x += ws[i];
      });
      y += h;
      return out;
    };

    if (pi === 0) {
      cell(0, 0, W, 45, "견       적       서", { size: 30, bold: true, align: "center", border: false });
      y = 100;
      const left = 345;
      const gap = 25;
      const right = W - left - gap;
      const rh = 20;
      const info: Array<[string, string]> = [
        ["견적번호 :", quote.number],
        ["수 신 :", quote.customer],
        ["참 조 :", quote.contact],
        ["작성일자 :", dateText(quote.date)],
        ["TEL. :", quote.phone],
        ["FAX. :", quote.email],
      ];
      for (const [a, b] of info) {
        cell(0, y, 110, rh, a, { bold: true, align: "center", fill: "#f2f2f2" });
        cell(110, y, left - 110, rh, b, { bold: true });
        y += rh;
      }
      let yy = 100;
      const xx = left + gap;
      cell(xx, yy, 100, 20, "상 호", { align: "center", bold: true, fill: "#f2f2f2" });
      cell(xx + 100, yy, 155, 20, SUPPLIER.name, { align: "center", bold: true });
      cell(xx + 255, yy, 35, 20, "대표", { align: "center", bold: true });
      cell(xx + 290, yy, right - 290, 20, SUPPLIER.ceo, { align: "center", bold: true });
      yy += 20;
      const rows: Array<[string, string, number]> = [
        ["사업자번호", SUPPLIER.bizNo, 20],
        ["주소", SUPPLIER.address, 40],
        ["연락처", SUPPLIER.contact, 20],
      ];
      for (const [a, b, h] of rows) {
        cell(xx, yy, 100, h, a, { align: "center", bold: true, fill: "#f2f2f2" });
        cell(xx + 100, yy, right - 100, h, b, { bold: true });
        yy += h;
      }
      cell(xx, yy, 100, 20, "담당자", { align: "center", bold: true, fill: "#f2f2f2" });
      cell(xx + 100, yy, 155, 20, quote.staffDisplay, { align: "center", bold: true });
      cell(xx + 255, yy, 35, 20, "H.P", { align: "center", bold: true });
      cell(xx + 290, yy, right - 290, 20, quote.staffPhone, { align: "center", bold: true });
      const logoBoxes: Array<[number, number, number]> = [
        [W - 170, 34, 41],
        [W - 136, 34, 41],
        [W - 102, 96, 19],
      ];
      logoBoxes.forEach(([x, w, h], i) => {
        const logo = deps.logos[i];
        if (logo) page.image(logo, x, 98 - h, w, h);
      });
      y += 12;
      row(["아래와 같이 견적서를 제출합니다"], [W], 24, { bold: true, border: false });
      row(['품 명 : "' + quote.title + '"'], [W], Math.max(30, textHeight(quote.title, W)), { bold: true, border: false });
      const tw = [130, 240, 80, W - 450 - (product ? widths[last] : 0)].concat(product ? [widths[last]] : []);
      cell(0, y, tw[0], 60, "특기 사항", { align: "center", bold: true, fill: "#f2f2f2" });
      cell(tw[0] + tw[1], y, tw[2], 60, "금액", { align: "center", bold: true, fill: "#f2f2f2" });
      [quote.validity, quote.delivery, quote.payment].forEach((v, j) => cell(tw[0], y + j * 20, tw[1], 20, v, { bold: true }));
      const topVals: Array<string | number> = [
        `일금 ${money(total)} 원정`,
        total,
        kind === "total" ? "V.A.T.(부가가치세) 미포함" : "V.A.T.(부가가치세) 포함",
      ];
      topVals.forEach((v, j) => {
        const c = cell(450, y + j * 20, tw[3], 20, v, { bold: true });
        if (j < 2) topAmounts.push([c, j]);
      });
      if (product) {
        cell(W - widths[last], y, widths[last], 60, quote.showFee ? FEE_SEPARATE : "", { align: "center", bold: true, size: 9 });
      }
      y += 68;
    }

    const heads = ["순번", "구분", "품목", "단위", "수량", ...(cost ? ["재료비", "노무비", "경비"] : ["단가"]), "합계", "비고"];
    row(heads, widths, 25, { align: "center", bold: true, fill: "#f2f2f2" });
    const blocks: Array<{ item: QuoteItem; block: Array<LayoutCell | null>; y: number; h: number }> = [];
    const genericHeight = Math.max(
      ...items.map((it) =>
        Math.max(40, textHeight(it.name, widths[2]), textHeight(it.note, widths[last]), textHeight(it.category, widths[1])),
      ),
    );

    items.forEach((it, local) => {
      const idx = product ? pi * 4 + local : local;
      const t = product ? it.template : undefined;
      const lines = t ? t.lines : [];
      const hs = lines.map((line) => Math.max(line.height * scale, textHeight(line.text, widths[2], (line.size ?? 11) * scale)));
      const images: Array<{ img: ImageData; w: number; h: number }> = [];
      let ih = 0;
      if (product && it.imageIds && it.imageIds.length > 0) {
        for (const iid of it.imageIds) {
          const img = deps.getImage(iid);
          if (!img) continue;
          const desired = t?.imageSizes?.[iid];
          let w: number;
          let h: number;
          if (desired) {
            w = desired[0] * scale;
            h = desired[1] * scale;
          } else {
            const px = imagePixelSize(img.data);
            if (!px) continue;
            const k = Math.min((widths[last] - 8) / px.width, 120 / px.height);
            w = px.width * k;
            h = px.height * k;
          }
          const f = Math.min(1, (widths[last] - 8) / w);
          w *= f;
          h *= f;
          images.push({ img, w, h });
          ih += h + 5;
        }
      }
      const note = formatItemNote(it.note);
      const nh = textHeight(note, widths[last], 9);
      const h = t
        ? Math.max(t.height * scale, fsum(hs), nh + ih + 6, textHeight(it.category, widths[1]))
        : Math.max(genericHeight, nh + ih + 6);
      const vals: Array<string | number> = [
        nums[idx],
        it.category,
        it.name,
        it.unit,
        it.qty,
        ...(cost ? [it.material ?? 0, it.labor ?? 0, it.expense ?? 0] : [it.price]),
        lineAmount(it, kind),
        note,
      ];
      const block: Array<LayoutCell | null> = [];
      vals.forEach((v, j) => {
        const w = widths[j];
        if (j === 2 && t) {
          let yy = y;
          lines.forEach((ln, n) => {
            cell(edges[j], yy, w, hs[n], ln.text, { ...meta(ln), border: false });
            yy += hs[n];
          });
          // 설명 칸을 둘러싸는 테두리용 빈 셀. 줄 셀은 원래 글꼴·색을 유지한다.
          if (y + h > yy + 0.01) cell(edges[j], yy, w, Math.max(0.02, y + h - yy), "", { border: false });
          block.push(null);
          return;
        }
        const st: CellInput = { size: 11, align: [0, 1, 3, 4, vals.length - 1].includes(j) ? "center" : j >= 5 ? "right" : "left" };
        if (j === 2) st.fill = "#eeece1";
        if (j === vals.length - 1) {
          st.size = 9;
          st.valign = images.length > 0 ? "top" : "center";
          if (t) st.color = t.cells.J?.color ?? "#000000";
        }
        block.push(cell(edges[j], y, w, h, v, st));
      });
      // 설명 칸 바깥 테두리: 내용 셀과 겹치지 않게 칸마다 필요한 변만 긋는다.
      if (t) {
        const desc = page.cells.filter((c) => Math.abs(c.x - edges[2]) < 0.001 && y <= c.y && c.y < y + h);
        desc.forEach((c, n) => {
          c.edges = [true, true, n === 0, n === desc.length - 1];
        });
      }
      const amount = block[block.length - 2]!;
      const qty = block[4]!;
      qty.fmt = 0;
      const prices = block.slice(5, -2) as LayoutCell[];
      const rate = it.priceRate;
      amount.formula = () => `ROUND(${qty.ref}*(${prices.map((p) => p.ref).join("+")})*${rate}/100,0)`;
      amount.role = "line";
      amount.bold = true;
      amountCells.push(amount);
      let iy = y + nh + Math.max(0, (h - nh - ih) / 2);
      for (const { img, w, h: ph } of images) {
        page.image(img, edges[last] + (widths[last] - w) / 2, iy, w, ph);
        iy += ph + 5;
      }
      blocks.push({ item: it, block, y, h });
      y += h;
    });

    if (quote.mergeCategories) {
      let start = 0;
      while (start < blocks.length) {
        let end = start + 1;
        const cat = blocks[start].item.category.trim();
        while (cat && end < blocks.length && blocks[end].item.category.trim() === cat) end++;
        if (end > start + 1) {
          for (const j of [0, 1]) {
            blocks[start].block[j]!.h = fsum(blocks.slice(start, end).map((b) => b.h));
            for (const b of blocks.slice(start + 1, end)) {
              const i = page.cells.indexOf(b.block[j]!);
              if (i >= 0) page.cells.splice(i, 1);
            }
          }
        }
        start = end;
      }
    }

    if (pi === chunks.length - 1) {
      if (quote.blankRows) {
        for (let j = 0; j < 2; j++) row([nums[nums.length - 1] + j + 1, ...Array<string>(widths.length - 1).fill("")], widths, 18, { align: "center" });
      }
      const sums: Array<[string, number]> =
        kind === "vat" || kind === "cost"
          ? [
              ["합 계", subtotal],
              ["부 가 세", tax],
              ["견 적 가", total],
            ]
          : [[product ? "합 계" : "견 적 가", total]];
      const summary: LayoutCell[] = [];
      sums.forEach(([label, v], j) => {
        const rr = row([label, v, ""], [fsum(widths.slice(0, -2)), widths[last - 1], widths[last]], 28, {
          align: "center",
          bold: true,
          fill: j === sums.length - 1 ? "#ffff00" : "#ffffff",
        });
        rr[1].align = "right";
        rr[1].role = "summary";
        summary.push(rr[1]);
      });
      const sumExpr = () => "SUM(" + amountCells.map((c) => c.ref).join(",") + ")";
      if (summary.length === 3) {
        summary[0].formula = sumExpr;
        summary[1].formula = () => `ROUND(${summary[0].ref}*0.1,0)`;
        summary[2].formula = () => `SUM(${summary[0].ref},${summary[1].ref})`;
      } else {
        summary[0].formula = product ? () => `IF(${sumExpr()}>=50000000,ROUND(${sumExpr()}*0.98,0),${sumExpr()})` : sumExpr;
      }
      const final = summary[summary.length - 1];
      for (const [c, j] of topAmounts) {
        if (j === 0) {
          c.formula = () => `"일금 "&TEXT(${final.ref},"#,##0")&" 원정"`;
          c.role = "topText";
        } else {
          c.formula = () => final.ref;
          c.role = "topValue";
        }
      }
      y += 12;
      row(["* NOTE"], [W], 20, { bold: true, fill: "#bfbfbf" });
      let note = quote.notes;
      if (product) {
        for (const from of FEE_INCLUDED) note = replaceAll(note, from, FEE_SEPARATE);
        if (!quote.showFee) note = splitLines(note).filter((l) => !l.includes("조달수수료")).join("\n");
      }
      row([note], [W], Math.max(42, textHeight(note, W) + 12));
    }
  });

  for (const page of pages) {
    if (product) {
      for (const c of page.cells) {
        c.font = "KoPub돋움체 Medium";
        c.bold = false;
      }
    }
    page.prepare();
  }
  return { pages, total };
}
