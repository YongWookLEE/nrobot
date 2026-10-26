/**
 * 메모리 이력 구현. 시험과 서버 렌더링(SSR)처럼 브라우저 저장소가 없는 곳에서 쓴다.
 * 새로고침하면 이력이 사라진다.
 */
import { checkManual, formatNumber, nextSerial } from "./rules";
import {
  MSG_UNKNOWN_STAFF,
  QuoteNumberError,
  type QuoteNumberEntry,
  type QuoteNumberStore,
  type StaffStart,
} from "./types";

/** 담당자 id로 시작값을 찾는다. 없으면 "작성자를 선택하세요." */
export function findStaff(staff: readonly StaffStart[], staffId: string): StaffStart {
  const found = staff.find((s) => s.id === staffId);
  if (!found) throw new QuoteNumberError(MSG_UNKNOWN_STAFF);
  return found;
}

/**
 * 이력을 읽고 쓰는 방법만 받아 경계를 만든다. 메모리·브라우저 구현이 함께 쓴다.
 * load는 매번 최신 이력을 돌려주고, save는 새 이력 전체를 저장한다.
 */
export function createStoreFromHistory(
  staff: readonly StaffStart[],
  load: () => QuoteNumberEntry[],
  save: (history: QuoteNumberEntry[]) => void,
): QuoteNumberStore {
  return {
    async previewNext(date, staffId) {
      const s = findStaff(staff, staffId);
      return formatNumber(date, nextSerial(load(), date, s));
    },
    async checkManual(number) {
      checkManual(load(), number);
    },
    async record(entry) {
      save([...load(), { date: entry.date, staffId: entry.staffId, number: entry.number, manual: entry.manual }]);
    },
  };
}

/** 메모리 이력 경계를 만든다. initial로 이력을 미리 넣을 수 있다. */
export function createMemoryQuoteNumberStore(
  staff: readonly StaffStart[],
  initial: readonly QuoteNumberEntry[] = [],
): QuoteNumberStore {
  let history: QuoteNumberEntry[] = [...initial];
  return createStoreFromHistory(
    staff,
    () => history,
    (next) => {
      history = next;
    },
  );
}
