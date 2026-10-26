import { afterEach, describe, expect, it } from "vitest";
import { loadStaff, parseStaffConfig, STAFF_CONFIG_ERROR } from "@/staff";

const ok = [
  { id: "s1", name: "홍길동", title: "과장", phone: "010-0000-0001", start: 1 },
  { id: "s2", name: "김철수", title: "", phone: "010-0000-0002", start: 999 },
];

function expectInvalid(json: string) {
  let err: unknown;
  try {
    parseStaffConfig(json);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message.startsWith(STAFF_CONFIG_ERROR)).toBe(true);
}

describe("담당자 설정", () => {
  it("메시지 상수", () => {
    expect(STAFF_CONFIG_ERROR).toBe("담당자 설정(STAFF_CONFIG)을 확인하세요");
  });

  it("올바른 설정을 읽고 표시 이름을 만든다", () => {
    const list = parseStaffConfig(JSON.stringify(ok));
    expect(list).toEqual([
      { ...ok[0], display: "홍길동 과장" },
      { ...ok[1], display: "김철수" },
    ]);
  });

  it("잘못된 설정은 거부한다", () => {
    const bad: unknown[] = [
      [],
      {},
      "x",
      [{ ...ok[0], id: "" }],
      [{ ...ok[0], id: 1 }],
      [ok[0], { ...ok[1], id: "s1" }],
      [{ ...ok[0], name: "" }],
      [{ ...ok[0], name: "가".repeat(31) }],
      [{ ...ok[0], title: "가".repeat(21) }],
      [{ ...ok[0], title: undefined }],
      [{ ...ok[0], phone: "0".repeat(31) }],
      [{ ...ok[0], start: 0 }],
      [{ ...ok[0], start: 1000 }],
      [{ ...ok[0], start: 1.5 }],
      [{ ...ok[0], start: "1" }],
      [null],
    ];
    for (const b of bad) expectInvalid(JSON.stringify(b));
    expectInvalid("not json");
    expectInvalid("");
  });

  it("경계값은 허용한다", () => {
    const list = parseStaffConfig(
      JSON.stringify([
        { id: "a", name: "가".repeat(30), title: "나".repeat(20), phone: "0".repeat(30), start: 999 },
      ]),
    );
    expect(list).toHaveLength(1);
  });

  describe("loadStaff", () => {
    const orig = process.env.STAFF_CONFIG;
    afterEach(() => {
      if (orig === undefined) delete process.env.STAFF_CONFIG;
      else process.env.STAFF_CONFIG = orig;
    });

    it("환경변수에서 읽고 값이 바뀌면 다시 읽는다", () => {
      process.env.STAFF_CONFIG = JSON.stringify(ok);
      const a = loadStaff();
      expect(a).toHaveLength(2);
      expect(loadStaff()).toBe(a);
      process.env.STAFF_CONFIG = JSON.stringify([ok[0]]);
      expect(loadStaff()).toHaveLength(1);
    });

    it("없으면 오류", () => {
      delete process.env.STAFF_CONFIG;
      expect(() => loadStaff()).toThrow(STAFF_CONFIG_ERROR);
    });
  });
});
