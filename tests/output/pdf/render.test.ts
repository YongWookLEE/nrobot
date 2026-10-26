import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { calculate, lineAmount } from "@/domain/calculate";
import { koreanAmount, money } from "@/domain/format";
import { isCatalogType, QUOTE_TYPES } from "@/domain/types";
import { hasMalgunFonts, MALGUN_MISSING, pdfFontFiles } from "@/output/fonts";
import { A4_HEIGHT, A4_WIDTH, PDF_AUTHOR, renderQuotePdfWithInfo } from "@/output/pdf";
import { createLoader } from "@/pricelists/load";
import { legacyPdfPath, legacyResults, loadFixtureCatalog, loadRenderInputs, toQuoteInput } from "./helpers";

async function inspect(buffer: Buffer) {
  const task = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    standardFontDataUrl: path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
  });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({
        text: content.items.map((item) => "str" in item ? item.str : "").join(""),
        view: page.view,
      });
    }
    return { pages, metadata: (await doc.getMetadata()).info };
  } finally {
    await task.destroy();
  }
}

const compact = (value: string) => value.replace(/\s/g, "");
const available = hasMalgunFonts();

describe("PDF 출력", () => {
  it("맑은 고딕이 없는 배포에서는 명확한 오류를 낸다", () => {
    expect(() => pdfFontFiles("vat", "tests/fixtures")).toThrow(MALGUN_MISSING);
  });

  for (const input of loadRenderInputs()) {
    it.skipIf(!available && !isCatalogType(input.input.quoteType as typeof QUOTE_TYPES[number]))(`${input.name}: 골든 입력의 페이지·금액·문서 속성`, async () => {
      const quote = await toQuoteInput(input.input);
      const { getImage } = await loadFixtureCatalog();
      const result = await renderQuotePdfWithInfo(quote, { getImage });
      const actual = await inspect(result.buffer);
      const expected = calculate(quote.items, quote.quoteType);
      const product = isCatalogType(quote.quoteType);
      expect(result.buffer.subarray(0, 5).toString()).toBe("%PDF-");
      expect(actual.pages).toHaveLength(product ? Math.ceil(quote.items.length / 4) : 1);
      expect(result.pages).toBe(actual.pages.length);
      expect(result.total).toBe(expected.total);
      const text = compact(actual.pages.map((page) => page.text).join(""));
      expect(text).toContain(`일금${koreanAmount(expected.total)}원정`);
      expect(text).toContain(product ? `${money(expected.total)}원` : `₩${money(expected.total)}`);
      for (const item of quote.items) expect(text).toContain(money(lineAmount(item, quote.quoteType)));
      expect(text).toContain(quote.quoteType === "total" ? "V.A.T.(부가가치세)미포함" : "V.A.T.(부가가치세)포함");
      expect(actual.metadata).toMatchObject({ Title: quote.title, Author: PDF_AUTHOR });
      actual.pages.forEach((page, index) => {
        expect(page.view[2]).toBeCloseTo(A4_WIDTH, 2);
        expect(page.view[3]).toBeCloseTo(A4_HEIGHT, 2);
        if (product) expect(page.text).toContain(`${index + 1} / ${actual.pages.length}`);
        if (index > 0) {
          expect(page.text).not.toContain("견적번호");
          expect(page.text).not.toContain("특기");
        }
        if (index < actual.pages.length - 1) expect(page.text).not.toContain("NOTE");
      });
      const legacy = legacyResults()?.find((item) => item.name === input.name);
      if (legacy) {
        expect(result.total).toBe(legacy.total);
        expect(actual.pages).toHaveLength(legacy.pages);
        const original = await inspect(readFileSync(legacyPdfPath(input.name)));
        const legacyText = compact(original.pages.map((page) => page.text).join(""));
        expect(legacyText).toContain(`일금${koreanAmount(expected.total)}원정`);
      }
    });
  }

  for (const type of QUOTE_TYPES) {
    it.skipIf(!available && !isCatalogType(type))(`${type}: 품목 수에 따른 실제 페이지 수와 축소`, async () => {
      const base = loadRenderInputs().find((value) => value.input.quoteType === type)!;
      const quote = await toQuoteInput(base.input);
      const { getImage } = await loadFixtureCatalog();
      for (const count of [1, 2, 4, 5, 8, 9, 20, 40, 100]) {
        const items = Array.from({ length: count }, (_, index) => ({ ...quote.items[index % quote.items.length], name: `품목${index + 1}\n한글규격설명`.repeat(2) }));
        const result = await renderQuotePdfWithInfo({ ...quote, items }, { getImage });
        const actual = await inspect(result.buffer);
        expect(actual.pages).toHaveLength(isCatalogType(type) ? Math.ceil(count / 4) : 1);
        expect(result.scale).toBeGreaterThan(0);
        expect(result.scale).toBeLessThanOrEqual(1);
        if (count === 100 && !isCatalogType(type)) expect(result.scale).toBeLessThan(1);
        if (isCatalogType(type)) expect(result.buffer.length).toBeLessThan(4_500_000);
      }
    }, 120_000);
  }

  it("수수료 표시를 끄면 안내 칸과 NOTE에서 모두 제거한다", async () => {
    const base = loadRenderInputs().find((value) => value.name === "catalog-1")!;
    const quote = await toQuoteInput(base.input);
    const { getImage } = await loadFixtureCatalog();
    for (const showFee of [true, false]) {
      const result = await renderQuotePdfWithInfo({ ...quote, showFee, notes: "일반 안내\n조달수수료(0.54%) 총계 포함\n조달수수료(0.54%) 합계 포함" }, { getImage });
      const text = compact((await inspect(result.buffer)).pages.map((page) => page.text).join(""));
      expect(text.includes("조달수수료")).toBe(showFee);
      expect(text).not.toContain("총계포함");
      expect(text).not.toContain("합계포함");
      expect(text).toContain("일반안내");
    }
  });

  it.skipIf(!existsSync("generated/pricelists/catalog.json"))("전체 변환 사진을 쓰는 100품목도 응답 한도 안에 들어간다", async () => {
    const loader = createLoader(path.join(process.cwd(), "generated/pricelists"));
    const imageIds = Object.keys(loader.loadProductCatalog().images);
    expect(imageIds.length).toBeGreaterThan(0);
    const base = loadRenderInputs().find((value) => value.name === "catalog-1")!;
    const quote = await toQuoteInput(base.input);
    // 실제 단가와 담당자는 사용하지 않고, 변환된 사진만 모든 종류를 한 번 이상 쓴다.
    const items = Array.from({ length: 100 }, (_, index) => ({
      category: "시험", name: `사진 시험 ${index + 1}`, unit: "대", note: "",
      qty: 1, price: 1000, priceRate: 100,
      imageIds: imageIds.filter((_, imageIndex) => imageIndex % 100 === index % 100),
    }));
    const result = await renderQuotePdfWithInfo({ ...quote, items }, { getImage: loader.loadCatalogImage });
    expect((await inspect(result.buffer)).pages).toHaveLength(25);
    expect(result.buffer.length).toBeLessThan(4_500_000);
    console.info(`사진 ${imageIds.length}종·100품목 PDF: ${result.buffer.length} bytes`);
  }, 120_000);
});
