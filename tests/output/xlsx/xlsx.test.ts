import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { calculate, isCatalogType, lineAmount, money, type QuoteInput, type QuoteItem } from "@/domain";
import { renderQuoteXlsx } from "@/output/xlsx";
import { colName } from "@/output/xlsx/layout";
import { round2, splitLines, textHeight } from "@/output/xlsx/pymath";
import {
  buildQuote,
  fixtureCatalog,
  evaluate,
  formulaCells,
  imageDeps,
  loadXlsx,
  normalizeFormula,
  RENDER_CASES,
  ROOT,
  type FormulaCell,
} from "./helpers";

const NO_IMAGES = { getImage: () => null };
const REF = String.raw`'[^']+'![A-Z]+\d+`;
const LINE_RE = new RegExp(String.raw`^ROUND\((${REF})\*\((${REF}(?:\+${REF})*)\)\*\d+(?:\.\d+)?/100,0\)$`);
const SUM_RE = new RegExp(String.raw`^SUM\(${REF}(?:,${REF})*\)$`);

interface Roles {
  lines: FormulaCell[];
  summary: FormulaCell[];
  topText: FormulaCell;
  topValue: FormulaCell;
}

/** 수식 셀을 역할로 나눈다. 모양이 규칙과 다르면 실패한다. */
function classify(cells: FormulaCell[]): Roles {
  const lines = cells.filter((c) => LINE_RE.test(c.formula));
  const topText = cells.filter((c) => c.formula.startsWith('"일금 "&TEXT('));
  const rest = cells.filter((c) => !lines.includes(c) && !topText.includes(c));
  const finalRef = /^"일금 "&TEXT\(('[^']+'![A-Z]+\d+),"#,##0"\)&" 원정"$/.exec(topText[0]?.formula ?? "")?.[1];
  expect(topText).toHaveLength(1);
  expect(finalRef).toBeDefined();
  const topValue = rest.filter((c) => c.formula === finalRef);
  expect(topValue).toHaveLength(1);
  const summary = rest.filter((c) => c !== topValue[0]);
  return { lines, summary, topText: topText[0], topValue: topValue[0] };
}

const refOf = (c: FormulaCell) => `'${c.sheet}'!${c.address}`;

function checkSummaryShape(type: QuoteInput["quoteType"], summary: FormulaCell[], lines: FormulaCell[]) {
  const sumAll = "SUM(" + lines.map(refOf).join(",") + ")";
  if (type === "vat" || type === "cost") {
    expect(summary).toHaveLength(3);
    expect(summary[0].formula).toBe(sumAll);
    expect(summary[1].formula).toBe(`ROUND(${refOf(summary[0])}*0.1,0)`);
    expect(summary[2].formula).toBe(`SUM(${refOf(summary[0])},${refOf(summary[1])})`);
  } else if (type === "total") {
    expect(summary).toHaveLength(1);
    expect(summary[0].formula).toMatch(SUM_RE);
    expect(summary[0].formula).toBe(sumAll);
  } else {
    expect(summary).toHaveLength(1);
    expect(summary[0].formula).toBe(`IF(${sumAll}>=50000000,ROUND(${sumAll}*0.98,0),${sumAll})`);
  }
}

/** 구조·계산값·수식 계산 결과를 모두 확인한다. */
async function checkWorkbook(quote: QuoteInput, buf: Buffer) {
  const { wb, zip } = await loadXlsx(buf);
  expect(zip.file("xl/workbook.xml")).not.toBeNull();
  const sheetCount = isCatalogType(quote.quoteType) ? Math.ceil(quote.items.length / 4) : 1;
  expect(wb.worksheets.map((w) => w.name)).toEqual(Array.from({ length: sheetCount }, (_, i) => (i === 0 ? "견적서" : `견적서_${i + 1}`)));

  const cells = formulaCells(wb);
  const roles = classify(cells);
  expect(roles.lines).toHaveLength(quote.items.length);
  const totals = calculate(quote.items, quote.quoteType);
  roles.lines.forEach((c, i) => {
    const want = lineAmount(quote.items[i], quote.quoteType);
    expect(c.result).toBe(want);
    expect(evaluate(wb, c.sheet, c.formula)).toBe(want);
    // 단가 칸 수: ③은 재료비+노무비+경비
    const priceRefs = LINE_RE.exec(c.formula)![2].split("+");
    expect(priceRefs).toHaveLength(quote.quoteType === "cost" ? 3 : 1);
    // 4품목마다 시트를 나눈다
    if (isCatalogType(quote.quoteType)) expect(c.sheet).toBe(wb.worksheets[Math.floor(i / 4)].name);
  });
  checkSummaryShape(quote.quoteType, roles.summary, roles.lines);
  const wantSummary = quote.quoteType === "vat" || quote.quoteType === "cost" ? [totals.subtotal, totals.tax, totals.total] : [totals.total];
  roles.summary.forEach((c, i) => {
    expect(c.result).toBe(wantSummary[i]);
    expect(evaluate(wb, c.sheet, c.formula)).toBe(wantSummary[i]);
    expect(c.sheet).toBe(wb.worksheets[wb.worksheets.length - 1].name);
  });
  expect(roles.topValue.sheet).toBe("견적서");
  expect(roles.topValue.result).toBe(totals.total);
  expect(evaluate(wb, "견적서", roles.topValue.formula)).toBe(totals.total);
  expect(roles.topText.result).toBe(`일금 ${money(totals.total)} 원정`);
  expect(evaluate(wb, "견적서", roles.topText.formula)).toBe(`일금 ${money(totals.total)} 원정`);

  // 수식은 이것뿐 (사용자 입력은 수식이 되지 않는다)
  expect(cells).toHaveLength(quote.items.length + wantSummary.length + 2);

  // 서식: 수량은 일반, 금액은 #,##0
  for (const c of roles.lines) {
    const ws = wb.getWorksheet(c.sheet)!;
    expect(ws.getCell(c.address).numFmt).toBe("#,##0");
    const qtyRef = LINE_RE.exec(c.formula)![1].split("!")[1];
    const qty = ws.getCell(qtyRef);
    expect(typeof qty.value).toBe("number");
    expect([undefined, "General"]).toContain(qty.numFmt);
  }
  for (const c of [...roles.summary, roles.topValue]) expect(wb.getWorksheet(c.sheet)!.getCell(c.address).numFmt).toBe("#,##0");

  // 글꼴 이름·굵기
  const product = isCatalogType(quote.quoteType);
  for (const ws of wb.worksheets) {
    ws.eachRow((row) =>
      row.eachCell((c) => {
        expect(c.font?.name).toBe(product ? "KoPub돋움체 Medium" : "맑은 고딕");
        if (product) expect(c.font?.bold ?? false).toBe(false);
      }),
    );
  }
  if (!product) expect(wb.getWorksheet("견적서")!.getCell("A1").font.bold).toBe(true);

  // 인쇄 설정
  wb.worksheets.forEach((ws, i) => {
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.orientation).toBe("portrait");
    expect(ws.pageSetup.fitToPage).toBe(true);
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.fitToHeight).toBe(1);
    expect(ws.views[0].showGridLines).toBe(false);
    expect(ws.views[0].zoomScale).toBe(85);
    expect(ws.headerFooter?.oddFooter ?? null).toBe(wb.worksheets.length > 1 ? `${i + 1} / ${wb.worksheets.length}` : null);
  });
  return { wb, roles };
}

describe("Excel 생성 — 시험 입력 전체", () => {
  for (const c of RENDER_CASES) {
    it(`${c.name}: 시트·수식·계산값·인쇄 설정`, async () => {
      const quote = await buildQuote(c.input);
      const buf = await renderQuoteXlsx(quote, await imageDeps());
      expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
      await checkWorkbook(quote, buf);
    });
  }
});

function manualQuote(type: QuoteInput["quoteType"], items: Array<Partial<QuoteItem>>, extra: Partial<QuoteInput> = {}): QuoteInput {
  return {
    quoteType: type,
    customer: "시험 거래처",
    contact: "",
    phone: "",
    email: "",
    title: "시험",
    number: "T-1",
    date: "2026-10-26",
    validity: "견적 유효기간 : 30일",
    delivery: "납품 : 협의",
    payment: "결제 : 협의",
    staffId: "a",
    staffDisplay: "홍길동 차장",
    staffPhone: "010-0000-0001",
    notes: "1. 시험",
    showFee: true,
    mergeCategories: true,
    blankRows: true,
    items: items.map((it) => ({ category: "", name: "품목", unit: "식", note: "", qty: 1, price: 0, priceRate: 100, ...it })),
    ...extra,
  };
}

describe("Excel 생성 — 규칙", () => {
  for (const type of ["vat", "total", "cost", "catalog", "catalog2"] as const) {
    it(`${type}: 1~100품목의 수식·시트 분할과 0원 계산값`, async () => {
      for (const count of [1, 2, 3, 4, 5, 8, 9, 10, 20, 40, 100]) {
        const quote = manualQuote(type, Array.from({ length: count }, (_, i) => ({
          name: `시험 ${i + 1}`,
          category: i % 3 ? "같은 구분" : "",
          price: 12_345,
          material: 1000,
          labor: 2813,
          expense: 84,
          qty: [1, 1.125, 3][i % 3],
          priceRate: [0, 77, 99.99, 100][i % 4],
        })));
        await checkWorkbook(quote, await renderQuoteXlsx(quote, NO_IMAGES));
      }
    }, 30_000);
  }

  it("받은 사람이 수량과 단가를 바꾸면 마지막 시트와 상단 수식도 다시 계산된다", async () => {
    const quote = manualQuote("catalog", Array.from({ length: 5 }, () => ({ price: 1000 })));
    const { wb, roles } = await checkWorkbook(quote, await renderQuoteXlsx(quote, NO_IMAGES));
    const first = roles.lines[0];
    const refs = LINE_RE.exec(first.formula)!;
    wb.getWorksheet(first.sheet)!.getCell(refs[1].split("!")[1]).value = 2;
    wb.getWorksheet(first.sheet)!.getCell(refs[2].split("!")[1]).value = 25_000_000;
    expect(evaluate(wb, roles.summary[0].sheet, roles.summary[0].formula)).toBe(49_003_920);
    expect(evaluate(wb, roles.topValue.sheet, roles.topValue.formula)).toBe(49_003_920);
    expect(evaluate(wb, roles.topText.sheet, roles.topText.formula)).toBe("일금 49,003,920 원정");
  });

  it("100개 연동 제품은 사진과 줄별 서식을 유지하며 4.5MB 미만이다", async () => {
    const sample = RENDER_CASES.find((c) => c.name === "catalog-4")!;
    const seed = await buildQuote(sample.input);
    const quote = { ...seed, items: Array.from({ length: 100 }, (_, i) => seed.items[i % seed.items.length]) };
    const buf = await renderQuoteXlsx(quote, await imageDeps());
    expect(buf.length).toBeLessThan(4_500_000);
    const { wb } = await checkWorkbook(quote, buf);
    expect(wb.worksheets).toHaveLength(25);
    const imagesPerItem = quote.items.reduce((n, item) => n + (item.imageIds?.length ?? 0), 0);
    expect(wb.worksheets.reduce((n, ws) => n + ws.getImages().length, 0)).toBe(imagesPerItem + 3);
    const { images } = await fixtureCatalog();
    expect(images.size).toBeGreaterThan(0);
  }, 30_000);

  it("'=', '+', '@'로 시작하는 입력은 문자로 들어간다", async () => {
    const quote = manualQuote("vat", [{ name: "=1+1", note: "+SUM(A1:A2)", category: "@cat", unit: "=A1" }], {
      customer: "=HYPERLINK(\"http://example.com\")",
      title: "@제목",
      notes: "=1+1",
    });
    const buf = await renderQuoteXlsx(quote, NO_IMAGES);
    const { wb } = await checkWorkbook(quote, buf);
    const values: unknown[] = [];
    wb.getWorksheet("견적서")!.eachRow((row) => row.eachCell((c) => values.push(c.value)));
    expect(values).toContain("=1+1");
    expect(values).toContain("+SUM(A1:A2)");
    expect(values).toContain("@cat");
    expect(values).toContain("=A1");
    expect(values).toContain('=HYPERLINK("http://example.com")');
    const { zip } = await loadXlsx(buf);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheetXml).not.toMatch(/<f>[^<]*(1\+1|HYPERLINK|A1:A2)/);
  });

  it("④⑤ 할인 경계 49,999,999 / 50,000,000에서 수식 결과와 계산값이 같다", async () => {
    for (const [price, want] of [
      [49_999_999, 49_999_999],
      [50_000_000, 49_000_000],
      [50_000_001, 49_000_001],
    ]) {
      for (const type of ["catalog", "catalog2"] as const) {
        const quote = manualQuote(type, [{ price }]);
        expect(calculate(quote.items, type).total).toBe(want);
        const { roles } = await checkWorkbook(quote, await renderQuoteXlsx(quote, NO_IMAGES));
        expect(roles.summary[0].result).toBe(want);
      }
    }
    // 여러 줄 합으로 경계를 넘는 경우 (시트 2개)
    const quote = manualQuote("catalog", [{ price: 10_000_000, qty: 4 }, { price: 3_333_333, qty: 3 }, { price: 1 }, { price: 1 }, { price: 1 }]);
    expect(calculate(quote.items, "catalog").total).toBe(49_000_002);
    await checkWorkbook(quote, await renderQuoteXlsx(quote, NO_IMAGES));
  });

  it("④⑤는 4품목마다 시트를 나누고 바닥글에 쪽 번호를 넣는다", async () => {
    for (const n of [1, 4, 5, 8, 9, 13]) {
      const quote = manualQuote("catalog2", Array.from({ length: n }, (_, i) => ({ price: 1000 * (i + 1), qty: 1.5 })));
      const { wb } = await checkWorkbook(quote, await renderQuoteXlsx(quote, NO_IMAGES));
      expect(wb.worksheets).toHaveLength(Math.ceil(n / 4));
    }
  });

  it("①②③은 시트 하나, ③은 재료비+노무비+경비 수식, 적용률 반영", async () => {
    for (const type of ["vat", "total", "cost"] as const) {
      const items = Array.from({ length: 12 }, (_, i) => ({
        category: i < 5 ? "장비" : "설치",
        price: 12345 * (i + 1),
        qty: [1, 2.5, 0.125, 3][i % 4],
        priceRate: [100, 90, 77.5, 33.33][i % 4],
        material: 1000 * i,
        labor: 2813,
        expense: 84,
      }));
      const quote = manualQuote(type, items, { mergeCategories: type !== "total", blankRows: type !== "cost" });
      const { wb } = await checkWorkbook(quote, await renderQuoteXlsx(quote, NO_IMAGES));
      expect(wb.worksheets).toHaveLength(1);
    }
  });

  it("조달수수료 칸과 NOTE 문구 규칙 (④⑤)", async () => {
    const notes = "1. 견적\n2. 조달수수료(0.54%) 합계 포함\n3. 조달수수료(0.54%) 총계 포함";
    const read = async (showFee: boolean) => {
      const quote = manualQuote("catalog", [{ price: 1000 }], { notes, showFee });
      const { wb } = await loadXlsx(await renderQuoteXlsx(quote, NO_IMAGES));
      const values: unknown[] = [];
      wb.getWorksheet("견적서")!.eachRow((row) => row.eachCell((c) => c.master === c && values.push(c.value)));
      return values;
    };
    const on = await read(true);
    expect(on).toContain("조달수수료(0.54%) 별도");
    expect(on).toContain("1. 견적\n2. 조달수수료(0.54%) 별도\n3. 조달수수료(0.54%) 별도");
    const off = await read(false);
    expect(off).not.toContain("조달수수료(0.54%) 별도");
    expect(off).toContain("1. 견적");
  });
});

describe("기존 계산 도우미", () => {
  it("round2는 파이썬 round(x, 2)와 같다", () => {
    expect(round2(0.125)).toBe(0.12);
    expect(round2(0.375)).toBe(0.38);
    expect(round2(2.675)).toBe(2.67);
    expect(round2(1.005)).toBe(1);
    expect(round2(123.456)).toBe(123.46);
  });
  it("splitLines는 파이썬 splitlines와 같다", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\n")).toEqual(["a"]);
    expect(splitLines("a\r\nb\rc\n\n")).toEqual(["a", "b", "c", ""]);
  });
  it("textHeight는 기존 height()와 같다", () => {
    expect(textHeight("가나다", 100)).toBeCloseTo(11 * 1.35 + 6, 10);
    // 0.55 × 20 = 11.000000000000002(보정 없는 합) → 파이썬 3.12 합은 11
    expect(textHeight("a".repeat(20), 11 * 0.55 * 20 / 1 + 6)).toBeCloseTo(11 * 1.35 + 6, 10);
    expect(colName(1)).toBe("A");
    expect(colName(27)).toBe("AA");
  });
});

// ---- 기존 결과와 비교 (private/ 가 있을 때만) ----
const LEGACY_DIR = path.join(ROOT, "private", "compare", "legacy");
const NEW_DIR = path.join(ROOT, "private", "compare", "new");
const hasLegacy = existsSync(LEGACY_DIR);

function formulaMap(wb: ExcelJS.Workbook) {
  return Object.fromEntries(formulaCells(wb).map((c) => [`${c.sheet}!${c.address}`, normalizeFormula(c.formula)]));
}

describe.skipIf(!hasLegacy)("기존 xlsx와 비교 (private/compare)", () => {
  for (const c of RENDER_CASES) {
    const legacyFile = path.join(LEGACY_DIR, `${c.name}.xlsx`);
    it.skipIf(!existsSync(legacyFile))(`${c.name}: 시트·수식·계산값·병합·인쇄 설정이 기존과 같다`, async () => {
      const quote = await buildQuote(c.input);
      const buf = await renderQuoteXlsx(quote, await imageDeps());
      mkdirSync(NEW_DIR, { recursive: true });
      writeFileSync(path.join(NEW_DIR, `${c.name}.xlsx`), buf);
      const mine = await loadXlsx(buf);
      const legacy = await loadXlsx(readFileSync(legacyFile), true);
      expect(mine.wb.worksheets.map((w) => w.name)).toEqual(legacy.wb.worksheets.map((w) => w.name));
      // 같은 좌표 격자 → 수식 위치와 내용(적용률 표기 제외)이 같다
      expect(formulaMap(mine.wb)).toEqual(formulaMap(legacy.wb));
      const results = (wb: ExcelJS.Workbook) => formulaCells(wb).map((f) => f.result);
      expect(results(mine.wb)).toEqual(results(legacy.wb));
      expect(mine.media).toBe(legacy.media);
      mine.wb.worksheets.forEach((ws, i) => {
        const old = legacy.wb.worksheets[i];
        expect(ws.model.merges.length).toBe(old.model.merges.length);
        expect([...ws.model.merges].sort()).toEqual([...old.model.merges].sort());
        expect(ws.rowCount).toBe(old.rowCount);
        expect(ws.columnCount).toBe(old.columnCount);
        const ps = (w: ExcelJS.Worksheet) => {
          const { paperSize, orientation, fitToPage, fitToWidth, fitToHeight, horizontalCentered, margins, printArea } = w.pageSetup;
          return { paperSize, orientation, fitToPage, fitToWidth, fitToHeight, horizontalCentered, margins, printArea: printArea?.replace(/\$/g, "") };
        };
        expect(ps(ws)).toEqual(ps(old));
        expect(ws.headerFooter?.oddFooter ?? null).toEqual(old.headerFooter?.oddFooter ?? null);
        expect(ws.views[0].showGridLines).toBe(old.views[0].showGridLines);
        expect(ws.views[0].zoomScale).toBe(old.views[0].zoomScale);
        // 열 너비·행 높이
        for (let col = 1; col <= ws.columnCount; col++) expect(ws.getColumn(col).width).toBeCloseTo(old.getColumn(col).width!, 3);
        for (let r = 1; r <= ws.rowCount; r++) expect(ws.getRow(r).height).toBeCloseTo(old.getRow(r).height, 3);
        // 값과 글꼴
        for (let r = 1; r <= ws.rowCount; r++) {
          for (let col = 1; col <= ws.columnCount; col++) {
            const a = ws.getCell(r, col);
            const b = old.getCell(r, col);
            const val = (x: ExcelJS.Cell) => {
              const master = x.master;
              return master.type === ExcelJS.ValueType.Formula ? master.result : x.value === "" ? null : x.value;
            };
            expect({ at: a.address, v: val(a) }).toEqual({ at: b.address, v: val(b) });
            expect({ at: a.address, name: a.font?.name, size: a.font?.size, bold: !!a.font?.bold, color: a.font?.color?.argb?.toUpperCase() }).toEqual({
              at: b.address,
              name: b.font?.name,
              size: b.font?.size,
              bold: !!b.font?.bold,
              color: b.font?.color?.argb?.toUpperCase(),
            });
            expect({ at: a.address, fill: (a.fill as ExcelJS.FillPattern)?.fgColor?.argb?.toUpperCase() }).toEqual({
              at: b.address,
              fill: (b.fill as ExcelJS.FillPattern)?.fgColor?.argb?.toUpperCase(),
            });
            const bd = (x: ExcelJS.Cell) => ["left", "right", "top", "bottom"].map((s) => !!(x.border as Record<string, { style?: string }>)?.[s]?.style);
            expect({ at: a.address, border: bd(a) }).toEqual({ at: b.address, border: bd(b) });
            expect({ at: a.address, h: a.alignment?.horizontal, v: a.alignment?.vertical, fmt: a.numFmt || "General" }).toEqual({
              at: b.address,
              h: b.alignment?.horizontal,
              v: b.alignment?.vertical,
              fmt: b.numFmt || "General",
            });
          }
        }
      });
    });
  }
});
