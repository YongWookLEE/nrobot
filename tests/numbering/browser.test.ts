import { describe, expect, it } from "vitest";
import {
  createBrowserQuoteNumberStore,
  QUOTE_NUMBER_STORAGE_KEY,
  MSG_UNKNOWN_STAFF,
  type StorageLike,
} from "@/numbering";

const STAFF = [
  { id: "a", start: 1 },
  { id: "b", start: 10 },
];
const D = "2026-10-26";

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("브라우저 저장소 구현", () => {
  it("키 하나에 JSON 이력을 저장하고, 다른 인스턴스가 이어 받는다", async () => {
    const storage = fakeStorage();
    const s1 = createBrowserQuoteNumberStore(STAFF, { storage });
    expect(await s1.previewNext(D, "a")).toBe("NSFF0-20261026-001");
    await s1.record({ date: D, staffId: "a", number: "NSFF0-20261026-001", manual: false });
    expect([...storage.data.keys()]).toEqual([QUOTE_NUMBER_STORAGE_KEY]);
    expect(JSON.parse(storage.data.get(QUOTE_NUMBER_STORAGE_KEY)!)).toHaveLength(1);
    const s2 = createBrowserQuoteNumberStore(STAFF, { storage });
    expect(await s2.previewNext(D, "a")).toBe("NSFF0-20261026-002");
  });

  it("미리보기만으로는 기록하지 않는다", async () => {
    const storage = fakeStorage();
    const s = createBrowserQuoteNumberStore(STAFF, { storage });
    await s.previewNext(D, "a");
    await s.checkManual("M-1");
    expect(storage.data.size).toBe(0);
  });

  it("모르는 담당자", async () => {
    const s = createBrowserQuoteNumberStore(STAFF, { storage: fakeStorage() });
    await expect(s.previewNext(D, "zz")).rejects.toThrow(MSG_UNKNOWN_STAFF);
  });

  it("깨진 JSON은 빈 이력으로 보고 오류를 알린다", async () => {
    const storage = fakeStorage();
    storage.data.set(QUOTE_NUMBER_STORAGE_KEY, "{not json");
    const errors: unknown[] = [];
    const s = createBrowserQuoteNumberStore(STAFF, { storage, onStorageError: (e) => errors.push(e) });
    expect(await s.previewNext(D, "a")).toBe("NSFF0-20261026-001");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("저장소를 쓸 수 없으면 메모리 이력으로 동작하고 오류를 알린다", async () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const errors: unknown[] = [];
    const s = createBrowserQuoteNumberStore(STAFF, { storage: throwing, onStorageError: (e) => errors.push(e) });
    expect(await s.previewNext(D, "a")).toBe("NSFF0-20261026-001");
    await s.record({ date: D, staffId: "a", number: "NSFF0-20261026-001", manual: false });
    expect(await s.previewNext(D, "a")).toBe("NSFF0-20261026-002");
    expect(s.storageError).not.toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("저장소가 아예 없어도(SSR) 죽지 않는다", async () => {
    const s = createBrowserQuoteNumberStore(STAFF, { storage: null });
    expect(await s.previewNext(D, "b")).toBe("NSFF0-20261026-010");
    expect(s.storageError).not.toBeNull();
  });
});
