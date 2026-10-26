import { describe, expect, it } from "vitest";
import validationGolden from "../golden/validation.json";
import pricelists from "../golden/pricelists.json";
import { validateQuote } from "@/domain/validate";
import type { CatalogEntry, CatalogTemplate, ProductCatalog, Staff } from "@/domain/types";

// 시험용 가짜 담당자 (골든 생성 스크립트와 같은 구조)
const STAFF: Staff[] = [
  { id: "a", name: "홍길동", title: "차장", phone: "010-0000-0001", start: 1 },
  { id: "b", name: "김철수", title: "차장", phone: "010-0000-0002", start: 10 },
  { id: "c", name: "이영희", title: "대리", phone: "010-0000-0003", start: 20 },
];

type GoldenCatalogEntry = Omit<CatalogEntry, "imageIds" | "template"> & {
  imageCount: number;
  template: Omit<CatalogTemplate, "imageSizes"> & { imageSizes: Array<[number, number]> };
};

/** 가격표 해석기(다른 작업)가 아직 없으므로 골든 요약으로 최소 가격표를 만든다. 사진 id는 재현하지 않는다. */
function catalogStub(): ProductCatalog {
  const entries = (pricelists.catalog.entries as unknown as GoldenCatalogEntry[]).map((e) => {
    const { imageCount, template, ...rest } = e;
    const imageIds = Array.from({ length: imageCount }, (_, i) => `${e.id}-img${i}`);
    const imageSizes: Record<string, [number, number]> = {};
    template.imageSizes.forEach((size, i) => {
      imageSizes[`${e.id}-img${i}`] = size;
    });
    return { ...rest, imageIds, template: { ...template, imageSizes } } as CatalogEntry;
  });
  return {
    entries,
    sheets: pricelists.catalog.sheets,
    warnings: pricelists.catalog.warnings,
    revision: validationGolden.catalogRevision,
  };
}

const CATALOG = catalogStub();
const ITEM_FIELDS = [
  "name",
  "category",
  "unit",
  "note",
  "qty",
  "price",
  "priceRate",
  "material",
  "labor",
  "expense",
  "catalogId",
  "model",
] as const;
const TOP_FIELDS = [
  "quoteType",
  "customer",
  "contact",
  "phone",
  "email",
  "title",
  "number",
  "date",
  "validity",
  "delivery",
  "payment",
  "staffPhone",
  "staffDisplay",
  "notes",
  "showFee",
  "mergeCategories",
  "blankRows",
  "staffId",
] as const;

type GoldenCase = {
  id: string;
  legacyInput: Record<string, unknown>;
  input: Record<string, unknown>;
  expected?: Record<string, unknown> & { items: Array<Record<string, unknown>> };
  error?: string;
};

describe("입력 검증 — 골든 일치", () => {
  const cases = validationGolden.cases as GoldenCase[];
  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const input = { ...c.input };
    // 기존 outputFormat 오류 사례는 새 형식 필드에 같은 값을 넣어 재현한다.
    if (c.id === "err-format") input.format = c.legacyInput.outputFormat;
    const result = validateQuote(input, STAFF, { catalog: CATALOG });
    if (c.error) {
      expect(result).toEqual({ ok: false, error: c.error });
      return;
    }
    expect(result.ok).toBe(true);
    if (!result.ok || !c.expected) return;
    const value = result.value as unknown as Record<string, unknown>;
    for (const k of TOP_FIELDS) expect([k, value[k]]).toEqual([k, c.expected[k]]);
    expect(result.value.items).toHaveLength(c.expected.items.length);
    c.expected.items.forEach((exp, i) => {
      const got = result.value.items[i] as unknown as Record<string, unknown>;
      for (const k of ITEM_FIELDS) {
        if (k in exp) expect([i, k, got[k]]).toEqual([i, k, exp[k]]);
        else expect([i, k, got[k]]).toEqual([i, k, undefined]);
      }
    });
  });
});

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  const ok = (validationGolden.cases as GoldenCase[]).find((c) => c.id === "ok-vat")!;
  return { ...ok.input, ...over };
}

describe("입력 검증 — 추가 규칙", () => {
  it("담당자 표시 이름은 서버 명단에서 가져온다(직급이 비면 이름만)", () => {
    const staff: Staff[] = [{ id: "z", name: "박시험", title: "", phone: "", start: 1 }];
    const r = validateQuote(base({ staffId: "z", staffDisplay: "조작된 이름" }), staff);
    expect(r.ok && r.value.staffDisplay).toBe("박시험");
  });

  it("옵션은 리터럴 true만 참, 없으면 참", () => {
    const r = validateQuote(base({ showFee: "true", mergeCategories: 1, blankRows: undefined }), STAFF);
    expect(r.ok && [r.value.showFee, r.value.mergeCategories, r.value.blankRows]).toEqual([false, false, true]);
  });

  it("xlsx 형식 허용, 그 외는 오류", () => {
    expect(validateQuote(base({ format: "xlsx" }), STAFF).ok).toBe(true);
    expect(validateQuote(base({ format: "both" }), STAFF)).toEqual({ ok: false, error: "저장 형식을 선택하세요." });
  });

  it("실제 없는 날짜는 오류", () => {
    const err = { ok: false, error: "작성일을 YYYY-MM-DD 형식으로 입력하세요." };
    expect(validateQuote(base({ date: "2026-02-30" }), STAFF)).toEqual(err);
    expect(validateQuote(base({ date: "2026-2-3" }), STAFF)).toEqual(err);
    expect(validateQuote(base({ date: "2028-02-29" }), STAFF).ok).toBe(true);
  });

  it("견적번호 제어 문자·101자는 오류", () => {
    const err = { ok: false, error: "견적번호는 1~100자로 입력하세요." };
    expect(validateQuote(base({ number: "A\tB" }), STAFF)).toEqual(err);
    expect(validateQuote(base({ number: "X".repeat(101) }), STAFF)).toEqual(err);
    expect(validateQuote(base({ number: "X".repeat(100) }), STAFF).ok).toBe(true);
  });

  it("숫자 형태 수량·단가도 받는다", () => {
    const r = validateQuote(base({ items: [{ name: "a", unit: "식", qty: 1.125, price: 1000, priceRate: 99.99 }] }), STAFF);
    expect(r.ok && r.value.items[0]).toMatchObject({ qty: 1.125, price: 1000, priceRate: 99.99 });
  });

  it("수량·단가를 읽을 수 없으면 입력 요청", () => {
    expect(validateQuote(base({ items: [{ name: "a", unit: "식", qty: "abc", price: "1" }] }), STAFF)).toEqual({
      ok: false,
      error: "1번 수량과 단가를 입력하세요.",
    });
    expect(validateQuote(base({ items: [{ name: "a", unit: "식", qty: "1" }] }), STAFF)).toEqual({
      ok: false,
      error: "1번 수량과 단가를 입력하세요.",
    });
  });

  it("적용률을 읽을 수 없으면 입력 요청, 없으면 100", () => {
    expect(validateQuote(base({ items: [{ name: "a", unit: "식", qty: "1", price: "1", priceRate: "x" }] }), STAFF)).toEqual({
      ok: false,
      error: "1번 적용률을 입력하세요.",
    });
    const r = validateQuote(base({ items: [{ name: "a", unit: "식", qty: "1", price: "1" }] }), STAFF);
    expect(r.ok && r.value.items[0].priceRate).toBe(100);
  });

  it("③은 단가를 무시하고 0으로 둔다", () => {
    const r = validateQuote(
      base({ quoteType: "cost", items: [{ name: "a", unit: "식", qty: "1", price: "abc", material: "1", labor: 2, expense: "0" }] }),
      STAFF,
    );
    expect(r.ok && r.value.items[0]).toMatchObject({ price: 0, material: 1, labor: 2, expense: 0 });
  });

  it("두 번째 품목 번호가 메시지에 들어간다", () => {
    const items = [
      { name: "a", unit: "식", qty: "1", price: "1" },
      { name: "b", unit: "식", qty: "1", price: "-1" },
    ];
    expect(validateQuote(base({ items }), STAFF)).toEqual({
      ok: false,
      error: "2번 수량은 양수(소수 셋째 자리까지), 단가는 0 이상의 정수로 입력하세요.",
    });
  });

  it("참고사항 2,000자까지 허용", () => {
    expect(validateQuote(base({ notes: "가".repeat(2000) }), STAFF).ok).toBe(true);
    expect(validateQuote(base({ notes: "가".repeat(2001) }), STAFF)).toEqual({ ok: false, error: "참고사항을 확인하세요." });
    expect(validateQuote(base({ notes: ["a"] }), STAFF)).toEqual({ ok: false, error: "참고사항을 확인하세요." });
  });

  it("직접 입력 행의 사진은 존재하는 id만 남긴다", () => {
    const known = new Set(["img-1"]);
    const r = validateQuote(
      base({
        quoteType: "catalog",
        catalogRevision: CATALOG.revision,
        items: [{ name: "직접", unit: "대", qty: "1", price: "1", imageIds: ["img-1", "없음", 3] }],
      }),
      STAFF,
      { catalog: CATALOG, imageExists: (id) => known.has(id) },
    );
    expect(r.ok && r.value.items[0].imageIds).toEqual(["img-1"]);
  });

  it("연동 행은 가격표 내용·사진·서식을 쓴다(단가 없는 항목은 입력 단가 유지)", () => {
    const entry = CATALOG.entries.find((e) => e.price === null)!;
    const r = validateQuote(
      base({
        quoteType: "catalog2",
        catalogRevision: CATALOG.revision,
        items: [{ catalogId: entry.id, name: "x", unit: "x", qty: "3", price: "777000", imageIds: ["무시"] }],
      }),
      STAFF,
      { catalog: CATALOG },
    );
    expect(r.ok && r.value.items[0]).toMatchObject({
      name: entry.name,
      unit: entry.unit,
      price: 777000,
      imageIds: entry.imageIds,
      template: entry.template,
      catalogId: entry.id,
      model: entry.model,
    });
    expect(r.ok && r.value.catalogRevision).toBe(CATALOG.revision);
  });
});
