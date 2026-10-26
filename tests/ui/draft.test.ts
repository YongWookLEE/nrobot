import { describe, expect, it } from "vitest";
import type { AccessEntry, CatalogEntry, ProductCatalog } from "@/domain";
import {
  addAccessEntry,
  addCatalogEntry,
  changeNotice,
  draftTotals,
  duplicateRow,
  editRow,
  formatMoneyTyping,
  MSG_MAX_ROWS,
  newDraft,
  newRow,
  normalizeDraft,
  removeRow,
  restoreAuto,
  syncLinkedRows,
  toGenerateRequest,
  type QuoteDraft,
} from "@/ui/draft";

const access = (over: Partial<AccessEntry> = {}): AccessEntry => ({
  id: "시트:5",
  title: "출입통제기",
  model: "EZ-0000",
  category: "출입",
  name: "출입통제기\nEZ-0000",
  unit: "대",
  qty: 1,
  price: 120000,
  note: "비고",
  costBucket: "material",
  ...over,
});

const template = { columns: [], height: 0, lines: [], cells: {}, header: {}, headerHeight: 0, imageSizes: {} } as unknown as CatalogEntry["template"];

const product = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: "p1",
  sheet: "카메라",
  row: 21,
  end: 22,
  model: "CAM-100",
  code: "CAM-100",
  title: "네트워크 카메라",
  category: "CCTV",
  name: "네트워크 카메라\nCAM-100/2MP",
  unit: "EA",
  qty: "2",
  price: 300000,
  note: "1년 보증",
  internalNote: "",
  imageIds: ["a".repeat(64)],
  terms: { validity: "30일", delivery: "발주 후 2주", payment: "현금", notes: ["1. 설치비 별도", "2. 운송비 포함"], fee: "조달수수료(0.54%) 총계 포함" },
  template,
  ...over,
});

const catalogOf = (entries: CatalogEntry[]): ProductCatalog => ({ entries, sheets: [{ name: "카메라", count: entries.length }], warnings: [], revision: "r1" });

const base = (): QuoteDraft => newDraft("2026-10-26", "a");

describe("금액 입력칸 쉼표·커서", () => {
  it("커서 오른쪽 숫자 개수를 유지한다", () => {
    // "1234|5" 상태에서 입력 직후: 커서 오른쪽 숫자 1개
    expect(formatMoneyTyping("12345", 4)).toEqual({ raw: "12345", display: "12,345", caret: 5 });
    expect(formatMoneyTyping("1,2345", 6)).toEqual({ raw: "12345", display: "12,345", caret: 6 });
    expect(formatMoneyTyping("1,000", 0)).toEqual({ raw: "1000", display: "1,000", caret: 0 });
  });
  it("숫자가 아니면 입력값을 그대로 둔다", () => {
    expect(formatMoneyTyping("12a", 3)).toEqual({ raw: "12a", display: "12a", caret: 3 });
  });
});

describe("③ 자동 노무비·경비", () => {
  it("재료비를 바꾸면 노무비 = round(재료비×2.8125), 경비 = round(노무비×0.03)", () => {
    const row = editRow(newRow(), "material", "1000");
    expect(row.labor).toBe("2813");
    expect(row.expense).toBe("84");
  });
  it("직접 입력하면 그 자동 상태가 꺼지고, 경비는 직접 입력한 노무비 기준이다", () => {
    let row = editRow(newRow(), "material", "1000");
    row = editRow(row, "labor", "5000");
    expect(row.autoLabor).toBe(false);
    expect(row.expense).toBe("150");
    row = editRow(row, "material", "2000");
    expect(row.labor).toBe("5000");
    row = restoreAuto(row, "labor");
    expect(row.autoLabor).toBe(true);
    expect(row.labor).toBe("5625");
  });
});

describe("출입통제 가격표 추가", () => {
  it("빈 줄 하나를 대체하고 구분=품목 종류, 품목명=모델명으로 넣는다", () => {
    const { draft } = addAccessEntry(base(), access());
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ category: "출입통제기", name: "EZ-0000", unit: "대", qty: "1", price: "120000", priceRate: "100", autoLabor: false, autoExpense: false });
  });
  it("모델명이 없으면 품목 종류를 품목명에 넣는다", () => {
    const { draft } = addAccessEntry(base(), access({ model: "" }));
    expect(draft.items[0].name).toBe("출입통제기");
  });
  it("③은 비용 성격에 따라 재료비 또는 노무비에 넣고 나머지는 0이다", () => {
    const d = { ...base(), quoteType: "cost" as const };
    expect(addAccessEntry(d, access()).draft.items[0]).toMatchObject({ material: "120000", labor: "0", expense: "0" });
    expect(addAccessEntry(d, access({ costBucket: "labor", unit: "식" })).draft.items[0]).toMatchObject({ material: "0", labor: "120000", expense: "0", unit: "식" });
  });
  it("④⑤에서는 추가하지 않는다", () => {
    const d = { ...base(), quoteType: "catalog" as const };
    expect(addAccessEntry(d, access()).draft).toBe(d);
  });
  it("100개를 넘으면 오류 문구를 돌려준다", () => {
    const d = { ...base(), items: Array.from({ length: 100 }, () => newRow({ name: "x" })) };
    expect(addAccessEntry(d, access()).error).toBe(MSG_MAX_ROWS);
    expect(duplicateRow(d, d.items[0].key).error).toBe(MSG_MAX_ROWS);
  });
});

describe("제품가격표 추가·연동", () => {
  it("첫 제품이면 조건·제목·참고사항을 채우고 수수료 문구를 '별도'로 바꾼다", () => {
    const { draft } = addCatalogEntry({ ...base(), quoteType: "catalog" }, product());
    expect(draft.items[0]).toMatchObject({ name: "네트워크 카메라\nCAM-100/2MP", qty: "2", price: "300000", catalogId: "p1" });
    expect(draft.validity).toBe("30일");
    expect(draft.delivery).toBe("발주 후 2주");
    expect(draft.payment).toBe("현금");
    expect(draft.title).toBe("네트워크 카메라");
    expect(draft.notes).toBe("1. 해당 건에 대한 견적가격입니다.\n2. 설치비 별도\n3. 운송비 포함\n4. 조달수수료(0.54%) 별도");
  });
  it("두 번째 제품은 조건을 바꾸지 않고, 제목이 있으면 유지한다", () => {
    const first = addCatalogEntry({ ...base(), quoteType: "catalog", title: "기존 제목" }, product()).draft;
    expect(first.title).toBe("기존 제목");
    const second = addCatalogEntry({ ...first, validity: "바꾼 값" }, product({ id: "p2" })).draft;
    expect(second.items).toHaveLength(2);
    expect(second.validity).toBe("바꾼 값");
  });
  it("단가가 없는 제품은 단가를 비워 둔다", () => {
    expect(addCatalogEntry({ ...base(), quoteType: "catalog" }, product({ price: null })).draft.items[0].price).toBe("");
  });
  it("가격표가 바뀌면 연동 줄을 새 값으로 바꾸고 수량·적용률은 유지한다", () => {
    let d = addCatalogEntry({ ...base(), quoteType: "catalog" }, product()).draft;
    d = { ...d, items: d.items.map((r) => ({ ...r, qty: "5", priceRate: "90" })) };
    const r = syncLinkedRows(d, catalogOf([product({ price: 310000, imageIds: [] })]));
    expect(r.draft.items[0]).toMatchObject({ price: "310000", qty: "5", priceRate: "90", imageIds: [] });
    expect(changeNotice(r.changes)).toBe("가격표가 바뀌어 다음 품목이 갱신되었습니다: 1번(단가·사진)");
    expect(r.missing).toEqual([]);
  });
  it("바뀐 것이 없으면 같은 초안을 돌려준다", () => {
    const d = addCatalogEntry({ ...base(), quoteType: "catalog" }, product()).draft;
    const r = syncLinkedRows(d, catalogOf([product()]));
    expect(r.draft).toBe(d);
    expect(r.changes).toEqual([]);
  });
  it("사라진 제품은 줄을 그대로 두고 번호를 알린다", () => {
    const d = addCatalogEntry({ ...base(), quoteType: "catalog" }, product()).draft;
    const r = syncLinkedRows(d, catalogOf([]));
    expect(r.missing).toEqual([1]);
    expect(r.draft).toBe(d);
  });
  it("단가 없는 제품의 직접 입력 단가는 덮어쓰지 않는다", () => {
    let d = addCatalogEntry({ ...base(), quoteType: "catalog" }, product({ price: null })).draft;
    d = { ...d, items: d.items.map((r) => ({ ...r, price: "777" })) };
    expect(syncLinkedRows(d, catalogOf([product({ price: null })])).draft.items[0].price).toBe("777");
  });
  it("복제는 연동 상태를 포함해 바로 아래에 넣는다", () => {
    let d = addCatalogEntry({ ...base(), quoteType: "catalog" }, product()).draft;
    d = { ...d, items: [...d.items, newRow({ name: "다른 줄" })] };
    const copied = duplicateRow(d, d.items[0].key).draft;
    expect(copied.items.map((r) => r.catalogId)).toEqual(["p1", "p1", ""]);
    expect(copied.items[1].key).not.toBe(copied.items[0].key);
  });
});

describe("줄 삭제", () => {
  it("마지막 줄을 지우면 빈 줄 하나를 남긴다", () => {
    const d = base();
    const after = removeRow(d, d.items[0].key);
    expect(after.items).toHaveLength(1);
    expect(after.items[0].key).not.toBe(d.items[0].key);
  });
});

describe("하단 합계 (src/domain 계산과 같다)", () => {
  it("① 부가세 표시: 줄마다 반올림 후 합산, 부가세 10%", () => {
    const d = { ...base(), items: [newRow({ name: "a", qty: "1.125", price: "1000", priceRate: "77" }), newRow({ name: "b", qty: "1", price: "999" })] };
    const t = draftTotals(d);
    expect(t.lines).toEqual([BigInt(866), BigInt(999)]);
    expect(t.subtotal).toBe(BigInt(1865));
    expect(t.tax).toBe(BigInt(187));
    expect(t.total).toBe(BigInt(2052));
  });
  it("④⑤ 5천만 원 경계: 같으면 2% 할인, 수수료는 더하지 않는다", () => {
    const d = { ...base(), quoteType: "catalog" as const, items: [newRow({ name: "a", price: "50000000" })] };
    const t = draftTotals(d);
    expect(t.total).toBe(BigInt(49000000));
    expect(t.fee).toBe(BigInt(264600));
    const below = draftTotals({ ...d, items: [newRow({ name: "a", price: "49999999" })] });
    expect(below.total).toBe(BigInt(49999999));
  });
  it("③은 재료비+노무비+경비, 잘못된 비용 칸은 0으로 친다", () => {
    const d = { ...base(), quoteType: "cost" as const, items: [newRow({ name: "a", material: "1000", labor: "x", expense: "10", autoLabor: false, autoExpense: false })] };
    expect(draftTotals(d).lines).toEqual([BigInt(1010)]);
  });
  it("잘못된 입력 줄은 0원이고, 범위를 넘으면 오류 문구를 낸다", () => {
    expect(draftTotals({ ...base(), items: [newRow({ name: "a", qty: "-1", price: "100" })] }).lines).toEqual([BigInt(0)]);
    const big = draftTotals({ ...base(), quoteType: "total", items: [newRow({ name: "a", qty: "1000000", price: "100000000000" })] });
    expect(big.error).toBe("견적 합계가 지원 범위를 초과합니다.");
  });
  it("같은 구분 묶기 순번", () => {
    const d = { ...base(), items: ["A", "A", "B"].map((c) => newRow({ category: c, name: "x" })) };
    expect(draftTotals(d).groups).toEqual([1, 1, 2]);
    expect(draftTotals({ ...d, mergeCategories: false }).groups).toEqual([1, 2, 3]);
  });
});

describe("생성 요청 본문", () => {
  it("spec 8절 필드만 보내고 일반 견적은 연동 id·사진을 비운다", () => {
    const d = { ...base(), customer: "거래처", title: "제목", items: [newRow({ name: "a", price: "1000", catalogId: "x", imageIds: ["y"] })] };
    const body = toGenerateRequest(d, "pdf", "NSFF0-20261026-001", "010-0000-0001", "r1");
    expect(Object.keys(body).sort()).toEqual(
      ["format", "quoteType", "customer", "contact", "phone", "email", "title", "validity", "delivery", "payment", "date", "number", "staffId", "staffPhone", "notes", "showFee", "mergeCategories", "blankRows", "items"].sort(),
    );
    expect((body.items as Array<Record<string, unknown>>)[0]).toMatchObject({ catalogId: "", imageIds: [] });
  });
  it("④⑤는 catalogRevision과 연동 id를 보낸다", () => {
    const d = addCatalogEntry({ ...base(), quoteType: "catalog2" }, product()).draft;
    const body = toGenerateRequest(d, "xlsx", "N", "", "r1");
    expect(body.catalogRevision).toBe("r1");
    expect((body.items as Array<Record<string, unknown>>)[0]).toMatchObject({ catalogId: "p1" });
  });
});

describe("저장된 초안 복원", () => {
  it("자동 상태·연동 id·직접 입력 번호 상태를 그대로 되살린다", () => {
    const d = { ...addCatalogEntry({ ...base(), quoteType: "catalog" }, product()).draft, number: "직접-1", numberManual: true };
    const restored = normalizeDraft(JSON.parse(JSON.stringify(d)), base());
    expect(restored).not.toBeNull();
    const { items, ...rest } = restored!;
    const { items: original, ...originalRest } = d;
    expect(rest).toEqual(originalRest);
    expect(items.map(({ key: _key, ...r }) => r)).toEqual(original.map(({ key: _key, ...r }) => r));
  });
  it("모양이 다르면 null", () => {
    expect(normalizeDraft(null, base())).toBeNull();
    expect(normalizeDraft({ items: "x" }, base())).toBeNull();
  });
});
