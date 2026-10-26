/**
 * 입력 초안·임시 저장을 브라우저 저장소에 둔다 (spec 15절). 서버에는 아무것도 저장하지 않는다.
 * 저장소를 쓸 수 없어도 화면은 계속 동작하고, 호출부가 오류 문구를 알린다.
 */
import type { StorageLike } from "@/numbering";

/** 입력이 바뀔 때마다 덮어쓰는 자동 저장 */
export const AUTO_DRAFT_KEY = "nrobot.quoteDraft.auto.v1";
/** '입력내용 임시 저장' 버튼으로만 쓰는 저장 */
export const SAVED_DRAFT_KEY = "nrobot.quoteDraft.saved.v1";
/** 담당자별로 이 브라우저에서 고친 휴대폰 { [담당자 id]: 휴대폰 } */
export const STAFF_PHONES_KEY = "nrobot.staffPhones.v1";

export const MSG_AUTOSAVE_FAILED = "브라우저 자동 저장 실패";

/**
 * 브라우저 저장소를 얻는다. 쓸 수 없으면 null.
 * @returns {StorageLike | null} 저장소
 */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * 값을 JSON으로 저장한다.
 * @param {StorageLike | null} storage 저장소
 * @param {string} key 키
 * @param {unknown} value 값
 * @returns {boolean} 저장했으면 true
 */
export function writeJson(storage: StorageLike | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * JSON 값을 읽는다. 없거나 깨졌거나 읽을 수 없으면 null.
 * @param {StorageLike | null} storage 저장소
 * @param {string} key 키
 * @returns {unknown} 읽은 값
 */
export function readJson(storage: StorageLike | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 이 브라우저에서 고친 담당자 휴대폰을 읽는다.
 * @param {StorageLike | null} storage 저장소
 * @returns {Record<string, string>} 담당자 id별 휴대폰
 */
export function readStaffPhones(storage: StorageLike | null): Record<string, string> {
  const value = readJson(storage, STAFF_PHONES_KEY);
  const phones: Record<string, string> = {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [id, phone] of Object.entries(value)) if (typeof phone === "string") phones[id] = phone;
  }
  return phones;
}
