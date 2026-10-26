import { describe, expect, it } from "vitest";
import golden from "../golden/numbering.json";
import {
  createMemoryQuoteNumberStore,
  resolveQuoteNumber,
  type QuoteNumberStore,
  type StaffStart,
} from "@/numbering";

interface Step {
  op?: "issue" | "preview";
  day?: string;
  staff?: string;
  staffId?: string;
  manual?: string;
  fail?: boolean;
  result?: string;
  error?: string;
  summary?: string;
}

const STAFF: StaffStart[] = Object.entries(golden.starts).map(([id, start]) => ({ id, start }));

/** 골든 한 단계를 경계 위에서 재현한다. fail이면 파일 생성 실패로 보고 record하지 않는다. */
async function runStep(store: QuoteNumberStore, step: Step): Promise<{ result?: string; error?: string }> {
  try {
    if (step.op === "preview") {
      return { result: await store.previewNext(step.day!, step.staffId!) };
    }
    const number = await resolveQuoteNumber(store, { date: step.day!, staffId: step.staffId!, manual: step.manual });
    if (step.fail) return { error: "FAILED_GENERATION" };
    await store.record({ date: step.day!, staffId: step.staffId!, number, manual: step.manual !== undefined });
    return { result: number };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function expected(step: Step): { result?: string; error?: string } {
  return step.error !== undefined ? { error: step.error } : { result: step.result };
}

describe("견적번호 골든 시나리오", () => {
  for (const scenario of golden.scenarios as { name: string; steps: Step[] }[]) {
    it(scenario.name, async () => {
      const store = createMemoryQuoteNumberStore(STAFF);
      const steps = scenario.steps;
      const summaryAt = steps.findIndex((s) => s.summary !== undefined);
      if (summaryAt < 0) {
        for (const [i, step] of steps.entries()) {
          expect(await runStep(store, step), `${scenario.name} #${i}`).toEqual(expected(step));
        }
        return;
      }
      // 잘린 시나리오: 앞 단계 → 생략 구간(같은 발급 반복) → 뒤 단계
      const head = steps.slice(0, summaryAt);
      const tail = steps.slice(summaryAt + 1);
      for (const step of head) expect(await runStep(store, step)).toEqual(expected(step));
      const template = head[head.length - 1];
      const firstTail = tail[0];
      let serial = Number(template.result!.slice(-3));
      const prefix = template.result!.slice(0, -3);
      const finalSerial = Number(firstTail.result!.slice(-3));
      let replayed = 0;
      while (serial + 1 < finalSerial) {
        serial += 1;
        const got = await runStep(store, { ...template, result: undefined });
        expect(got).toEqual({ result: prefix + String(serial).padStart(3, "0") });
        replayed += 1;
      }
      expect(replayed).toBeGreaterThan(0);
      for (const step of tail) expect(await runStep(store, step)).toEqual(expected(step));
    });
  }
});
