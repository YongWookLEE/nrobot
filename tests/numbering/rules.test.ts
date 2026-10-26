import { describe, expect, it } from "vitest";
import {
  checkManual,
  formatNumber,
  nextSerial,
  QuoteNumberError,
  MSG_DUPLICATE,
  MSG_EXHAUSTED,
  MSG_MANUAL_INVALID,
  type QuoteNumberEntry,
} from "@/numbering";

const D = "2026-10-26";
const auto = (serial: number, staffId = "a", date = D): QuoteNumberEntry => ({
  date,
  staffId,
  number: formatNumber(date, serial),
  manual: false,
});
const manual = (number: string, staffId = "a", date = D): QuoteNumberEntry => ({ date, staffId, number, manual: true });

describe("formatNumber", () => {
  it("NSFF0-YYYYMMDD-NNN", () => {
    expect(formatNumber(D, 1)).toBe("NSFF0-20261026-001");
    expect(formatNumber("2026-01-05", 999)).toBe("NSFF0-20260105-999");
  });
  it("잘못된 날짜·번호는 거부", () => {
    expect(() => formatNumber("20261026", 1)).toThrow(QuoteNumberError);
    expect(() => formatNumber(D, 0)).toThrow(QuoteNumberError);
    expect(() => formatNumber(D, 1000)).toThrow(QuoteNumberError);
  });
});

describe("nextSerial", () => {
  it("이력 없으면 시작값", () => {
    expect(nextSerial([], D, { id: "b", start: 10 })).toBe(10);
  });
  it("그 담당자 최대+1, 다른 날짜는 무시", () => {
    expect(nextSerial([auto(1), auto(2), auto(5, "a", "2026-10-27")], D, { id: "a", start: 1 })).toBe(3);
  });
  it("다른 담당자·직접 입력 파생 번호는 건너뜀", () => {
    const h = [auto(1), auto(3, "b"), manual("NSFF0-20261026-002", "b"), manual("NSFF0-20261026-004", "b")];
    expect(nextSerial(h, D, { id: "a", start: 1 })).toBe(5);
  });
  it("다른 날짜의 직접 입력 번호는 건너뛰지 않음", () => {
    expect(nextSerial([manual("NSFF0-20261027-001")], D, { id: "a", start: 1 })).toBe(1);
  });
  it("직접 입력 번호는 담당자 최대에 들어가지 않음", () => {
    expect(nextSerial([manual("NSFF0-20261026-002")], D, { id: "a", start: 1 })).toBe(1);
  });
  it("999 넘으면 오류", () => {
    expect(() => nextSerial([auto(999, "c")], D, { id: "c", start: 20 })).toThrow(MSG_EXHAUSTED);
  });
});

describe("checkManual", () => {
  it("형식 오류", () => {
    for (const bad of ["", " ", "\t", "A\nB", "X".repeat(101)]) {
      expect(() => checkManual([], bad)).toThrow(MSG_MANUAL_INVALID);
    }
    expect(() => checkManual([], "X".repeat(100))).not.toThrow();
  });
  it("직접 입력 이력과 같은 문자열은 거부", () => {
    expect(() => checkManual([manual("ABC-1", "b")], "ABC-1")).toThrow(MSG_DUPLICATE);
  });
  it("자동 발급된 날짜·번호와 같으면 거부 (입력 문자열의 날짜 기준)", () => {
    expect(() => checkManual([auto(3)], "NSFF0-20261026-003")).toThrow(MSG_DUPLICATE);
    expect(() => checkManual([auto(3)], "NSFF0-20261027-003")).not.toThrow();
  });
});
