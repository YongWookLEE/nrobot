import { describe, expect, it, vi } from "vitest";
import { createMemoryQuoteNumberStore, type QuoteNumberEntry, type QuoteNumberStore } from "@/numbering";
import { filenameFrom, generateQuote, type GenerateJob } from "@/ui/generate";

const STAFF = [{ id: "a", start: 1 }, { id: "b", start: 10 }];

/**
 * 기록 내용을 볼 수 있는 메모리 번호 경계를 만든다.
 * @param {QuoteNumberEntry[]} initial 처음 이력
 * @returns {{store: QuoteNumberStore, recorded: QuoteNumberEntry[]}} 경계와 기록 목록
 */
function trackedStore(initial: QuoteNumberEntry[] = []) {
  const inner = createMemoryQuoteNumberStore(STAFF, initial);
  const recorded: QuoteNumberEntry[] = [];
  const store: QuoteNumberStore = {
    previewNext: inner.previewNext,
    checkManual: inner.checkManual,
    async record(entry) {
      recorded.push(entry);
      await inner.record(entry);
    },
  };
  return { store, recorded };
}

/**
 * 형식별 응답을 정해 둔 가짜 요청 함수.
 * @param {Record<string, number>} statusByFormat 형식별 응답 코드
 * @returns {{fetchImpl: typeof fetch, bodies: Array<Record<string, unknown>>}} 요청 함수와 받은 본문
 */
function fakeFetch(statusByFormat: Record<string, number>) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    const status = statusByFormat[String(body.format)] ?? 200;
    if (status !== 200) return Response.json({ error: "1번 품목명과 단위를 입력하세요." }, { status });
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-disposition": `attachment; filename="quote.${body.format}"; filename*=UTF-8''${encodeURIComponent(`견적서_시험.${body.format}`)}` },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

const job = (over: Partial<GenerateJob> = {}): GenerateJob => ({
  date: "2026-10-26",
  staffId: "a",
  saveFormat: "pdf",
  body: (format, number) => ({ format, number }),
  ...over,
});

describe("만들기 순서와 번호 기록", () => {
  it("함께 저장은 같은 번호로 두 번 요청하고, 둘 다 성공한 뒤 한 번만 기록한다", async () => {
    const { store, recorded } = trackedStore();
    const { fetchImpl, bodies } = fakeFetch({});
    const saved: string[][] = [];
    const number = await generateQuote(job({ saveFormat: "both" }), store, (files) => saved.push(files.map((f) => f.name)), fetchImpl);
    expect(number).toBe("NSFF0-20261026-001");
    expect(bodies).toEqual([{ format: "pdf", number }, { format: "xlsx", number }]);
    expect(saved).toEqual([["견적서_시험.pdf", "견적서_시험.xlsx"]]);
    expect(recorded).toEqual([{ date: "2026-10-26", staffId: "a", number, manual: false }]);
    expect(await store.previewNext("2026-10-26", "a")).toBe("NSFF0-20261026-002");
  });

  it("두 번째 요청이 실패하면 내려받지도 기록하지도 않고, 다음 번호가 그대로다", async () => {
    const { store, recorded } = trackedStore();
    const { fetchImpl } = fakeFetch({ xlsx: 400 });
    const save = vi.fn();
    await expect(generateQuote(job({ saveFormat: "both" }), store, save, fetchImpl)).rejects.toThrow("1번 품목명과 단위를 입력하세요.");
    expect(save).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
    expect(await store.previewNext("2026-10-26", "a")).toBe("NSFF0-20261026-001");
  });

  it("첫 요청이 실패하면 두 번째 요청을 보내지 않는다", async () => {
    const { store } = trackedStore();
    const { fetchImpl, bodies } = fakeFetch({ pdf: 500 });
    await expect(generateQuote(job({ saveFormat: "both" }), store, vi.fn(), fetchImpl)).rejects.toThrow();
    expect(bodies).toHaveLength(1);
  });

  it("연결 실패도 기록하지 않는다", async () => {
    const { store, recorded } = trackedStore();
    const fetchImpl = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    await expect(generateQuote(job(), store, vi.fn(), fetchImpl)).rejects.toThrow("서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
    expect(recorded).toEqual([]);
  });

  it("직접 입력 번호는 검사 후 그대로 쓰고 manual로 기록한다. 중복이면 요청하지 않는다", async () => {
    const { store, recorded } = trackedStore();
    const { fetchImpl, bodies } = fakeFetch({});
    await generateQuote(job({ manualNumber: "특별-1", saveFormat: "xlsx" }), store, vi.fn(), fetchImpl);
    expect(recorded).toEqual([{ date: "2026-10-26", staffId: "a", number: "특별-1", manual: true }]);
    await expect(generateQuote(job({ manualNumber: "특별-1" }), store, vi.fn(), fetchImpl)).rejects.toThrow("이미 발급된 견적번호입니다. 다른 번호를 입력하세요.");
    expect(bodies).toHaveLength(1);
  });
});

describe("파일 이름", () => {
  it("filename*의 UTF-8 이름을 읽고, 없으면 기본 이름을 쓴다", () => {
    expect(filenameFrom(`attachment; filename="quote.pdf"; filename*=UTF-8''${encodeURIComponent("견적서_가나다.pdf")}`, "x")).toBe("견적서_가나다.pdf");
    expect(filenameFrom(null, "견적서.pdf")).toBe("견적서.pdf");
  });
});
