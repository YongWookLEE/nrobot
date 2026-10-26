import { describe, expect, it } from "vitest";
import formatGolden from "../golden/format.json";
import {
  categoryGroups,
  categorySpans,
  formatItemNote,
  koreanAmount,
  money,
  qtyText,
  safeCustomerName,
} from "@/domain/format";

describe("한글 금액 — 골든 일치", () => {
  for (const { n, text } of formatGolden.koreanAmount) {
    it(`${n}`, () => expect(koreanAmount(n)).toBe(text));
  }
});

/** 기존 reportlab SPAN 명령에서 (품목 시작, 끝) 인덱스를 뽑는다. 표의 행 = 품목 인덱스 + 1. */
function spansFromLegacy(commands: string[][]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const cmd of commands) {
    if (cmd[0] !== "SPAN") continue;
    const start = /^\((\d+), (\d+)\)$/.exec(cmd[1]);
    const end = /^\((\d+), (\d+)\)$/.exec(cmd[2]);
    if (!start || !end || start[1] !== "0") continue;
    out.push([Number(start[2]) - 1, Number(end[2]) - 1]);
  }
  return out;
}

describe("구분 묶음 순번·병합 — 골든 일치", () => {
  for (const g of formatGolden.categoryGroups) {
    const items = g.categories.map((category) => ({ category }));
    it(`${JSON.stringify(g.categories)} enabled=${g.enabled}`, () => {
      expect(categoryGroups(items, g.enabled)).toEqual(g.numbers);
      expect(categorySpans(items, g.enabled)).toEqual(spansFromLegacy(g.spans));
    });
  }
});

describe("비고 조달식별번호 줄바꿈 — 골든 일치", () => {
  for (const { in: input, out } of formatGolden.itemNote) {
    it(input, () => expect(formatItemNote(input)).toBe(out));
  }
});

describe("수량 표기 — 골든 일치(지수 표기만 의도적으로 다름)", () => {
  for (const { qty, text } of formatGolden.qtyText) {
    if (text.includes("e")) {
      it(`${qty}: 기존은 ${text}, 새 구현은 지수 표기를 쓰지 않는다`, () => {
        expect(text).toBe("1e+06");
        expect(qtyText(qty)).toBe("1000000");
      });
    } else {
      it(`${qty}`, () => expect(qtyText(qty)).toBe(text));
    }
  }
  it("동률은 짝수 쪽으로(파이썬 :g와 동일)", () => {
    expect(qtyText(1234.375)).toBe("1234.38");
    expect(qtyText(12345.25)).toBe("12345.2");
    expect(qtyText(0.001)).toBe("0.001");
  });
});

describe("거래처 파일명", () => {
  it("금지 문자를 _로 바꾸고 앞뒤 공백·점을 지운다", () => {
    expect(safeCustomerName(' .시험<거래처>:"/\\|?*. ')).toBe("시험_거래처________");
    expect(safeCustomerName("a\u0001b")).toBe("a_b");
  });
  it("40자로 자르고, 비면 '거래처'", () => {
    expect(safeCustomerName("가".repeat(50))).toBe("가".repeat(40));
    expect(safeCustomerName(" .. ")).toBe("거래처");
    expect(safeCustomerName("")).toBe("거래처");
  });
});

describe("천 단위 쉼표", () => {
  it("숫자", () => {
    expect(money(0)).toBe("0");
    expect(money(999)).toBe("999");
    expect(money(1000)).toBe("1,000");
    expect(money(9_999_999_999_999)).toBe("9,999,999,999,999");
    expect(money(BigInt(1234567))).toBe("1,234,567");
  });
});
