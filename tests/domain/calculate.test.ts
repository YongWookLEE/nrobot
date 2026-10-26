import { describe, expect, it } from "vitest";
import calcGolden from "../golden/calc.json";
import {
  autoExpense,
  autoLabor,
  calculate,
  catalogTotals,
  lineAmount,
  TOTAL_RANGE_ERROR,
} from "@/domain/calculate";
import type { QuoteType } from "@/domain/types";

type GoldenItem = {
  qty: number;
  priceRate: number;
  price: number;
  material?: number;
  labor?: number;
  expense?: number;
};

type GoldenCase = {
  id: string;
  quoteType: QuoteType;
  items: GoldenItem[];
  lines?: number[];
  expected?: { subtotal: number; tax: number; total: number };
  catalogTotals?: { discounted: number; fee: number; withFee: number };
  error?: string;
};

const cases = calcGolden.cases as GoldenCase[];

describe("견적 계산 — 골든 일치", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    if (c.lines) {
      expect(c.items.map((it) => lineAmount(it, c.quoteType))).toEqual(c.lines);
    }
    if (c.error) {
      expect(c.error).toBe(TOTAL_RANGE_ERROR);
      expect(() => calculate(c.items, c.quoteType)).toThrow(TOTAL_RANGE_ERROR);
      return;
    }
    const result = calculate(c.items, c.quoteType);
    expect(result).toEqual(c.expected);
    if (c.catalogTotals) {
      expect(catalogTotals(result.subtotal)).toEqual(c.catalogTotals);
    }
  });

  it("골든 사례 수가 충분하다", () => {
    expect(cases.length).toBeGreaterThan(80);
  });
});

describe("③ 자동 노무비·경비 — 골든 일치", () => {
  for (const a of calcGolden.auto as unknown as Array<Record<string, number>>) {
    if ("material" in a) {
      it(`재료비 ${a.material}`, () => {
        expect(autoLabor(a.material)).toBe(a.autoLabor);
        expect(autoExpense(autoLabor(a.material))).toBe(a.autoExpenseFromLabor);
      });
    } else {
      it(`노무비 ${a.labor}`, () => {
        expect(autoExpense(a.labor)).toBe(a.autoExpense);
      });
    }
  }
});

describe("경계값", () => {
  it("50,000,000원 정확히는 할인한다", () => {
    expect(calculate([{ qty: 1, price: 50_000_000, priceRate: 100 }], "catalog").total).toBe(49_000_000);
    expect(calculate([{ qty: 1, price: 49_999_999, priceRate: 100 }], "catalog2").total).toBe(49_999_999);
  });
  it(".5는 올림한다", () => {
    expect(lineAmount({ qty: 0.5, price: 1, priceRate: 100 }, "vat")).toBe(1);
    expect(calculate([{ qty: 1, price: 5, priceRate: 100 }], "vat")).toEqual({ subtotal: 5, tax: 1, total: 6 });
  });
  it("문자열 수량·적용률도 같은 결과", () => {
    expect(lineAmount({ qty: "1.125", price: "128000", priceRate: "50" }, "vat")).toBe(72000);
  });
  it("합계 9,999,999,999,999는 허용, 초과는 오류", () => {
    expect(calculate([{ qty: 1, price: 9_999_999_999_999, priceRate: 100 }], "total").total).toBe(9_999_999_999_999);
    expect(() => calculate([{ qty: 1, price: 10_000_000_000_000, priceRate: 100 }], "total")).toThrow(TOTAL_RANGE_ERROR);
  });
  it("조달수수료는 견적가에 더하지 않는다", () => {
    const r = calculate([{ qty: 1, price: 100_000_000, priceRate: 100 }], "catalog");
    expect(r.total).toBe(98_000_000);
    expect(catalogTotals(r.subtotal)).toEqual({ discounted: 98_000_000, fee: 529_200, withFee: 98_529_200 });
  });
});
