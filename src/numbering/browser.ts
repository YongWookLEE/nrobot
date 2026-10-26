/**
 * 브라우저 저장소(localStorage) 구현.
 * 저장소 키 하나에 이력 전체를 JSON 배열로 둔다. 다른 브라우저·탭과는 번호가 겹칠 수 있다(받아들인 한계).
 */
import { createStoreFromHistory } from "./memory";
import { isQuoteNumberEntry } from "./rules";
import type { QuoteNumberEntry, QuoteNumberStore, StaffStart } from "./types";

export const QUOTE_NUMBER_STORAGE_KEY = "nrobot.quoteNumberHistory.v1";

/** localStorage에서 쓰는 부분만 (시험에서 가짜로 바꿔 끼운다) */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BrowserStoreOptions {
  /** 쓸 저장소. 생략하면 window.localStorage, null이면 저장소 없음(메모리로만 동작) */
  storage?: StorageLike | null;
  /** 저장소 키. 기본값 QUOTE_NUMBER_STORAGE_KEY */
  key?: string;
  /** 저장소를 읽거나 쓰지 못했을 때 알림. 화면은 이걸로 경고를 띄운다. 발급은 메모리 이력으로 계속된다. */
  onStorageError?: (error: Error) => void;
}

/** 브라우저 구현 경계. storageError가 null이 아니면 이번 세션의 이력이 저장되지 않고 있다는 뜻이다. */
export interface BrowserQuoteNumberStore extends QuoteNumberStore {
  readonly storageError: Error | null;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * 브라우저 저장소 경계를 만든다.
 * 저장소를 쓸 수 없으면(없음·차단·깨진 값·용량 초과) 메모리 이력으로 동작하고 onStorageError로 알린다. 죽지 않는다.
 */
export function createBrowserQuoteNumberStore(
  staff: readonly StaffStart[],
  options: BrowserStoreOptions = {},
): BrowserQuoteNumberStore {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const key = options.key ?? QUOTE_NUMBER_STORAGE_KEY;
  let fallback: QuoteNumberEntry[] = [];
  let failed = false;
  let lastError: Error | null = null;

  const report = (e: unknown) => {
    failed = true;
    lastError = toError(e);
    options.onStorageError?.(lastError);
  };

  if (!storage) report(new Error("브라우저 저장소를 쓸 수 없습니다."));

  const load = (): QuoteNumberEntry[] => {
    if (!storage || failed) return fallback;
    try {
      const raw = storage.getItem(key);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("견적번호 발급 이력 형식이 올바르지 않습니다.");
      return parsed.filter(isQuoteNumberEntry);
    } catch (e) {
      report(e);
      fallback = [];
      return fallback;
    }
  };

  const save = (history: QuoteNumberEntry[]) => {
    if (storage && !failed) {
      try {
        storage.setItem(key, JSON.stringify(history));
        return;
      } catch (e) {
        report(e);
      }
    }
    fallback = history;
  };

  const base = createStoreFromHistory(staff, load, save);
  return {
    ...base,
    get storageError() {
      return lastError;
    },
  };
}
