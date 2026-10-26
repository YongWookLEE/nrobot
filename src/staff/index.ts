import type { StaffProfile } from "@/domain/types";

export const STAFF_CONFIG_ERROR = "담당자 설정(STAFF_CONFIG)을 확인하세요";

function fail(detail: string): never {
  throw new Error(`${STAFF_CONFIG_ERROR} (${detail})`);
}

function charLength(s: string): number {
  return Array.from(s).length;
}

/** STAFF_CONFIG JSON 문자열을 검증해 담당자 목록으로 바꾼다. */
export function parseStaffConfig(json: string): StaffProfile[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    fail("JSON 형식이 아닙니다");
  }
  if (!Array.isArray(data) || data.length === 0) fail("담당자가 1명 이상 있어야 합니다");

  const seen = new Set<string>();
  return data.map((item: unknown, i): StaffProfile => {
    const n = i + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${n}번째 항목이 올바르지 않습니다`);
    const { id, name, title, phone, start } = item as Record<string, unknown>;

    if (typeof id !== "string" || id.trim() === "") fail(`${n}번째 id가 비어 있습니다`);
    if (seen.has(id)) fail(`${n}번째 id가 중복됩니다`);
    seen.add(id);
    if (typeof name !== "string" || name.trim() === "" || charLength(name) > 30)
      fail(`${n}번째 이름은 1~30자여야 합니다`);
    if (typeof title !== "string" || charLength(title) > 20) fail(`${n}번째 직급은 20자 이하여야 합니다`);
    if (typeof phone !== "string" || charLength(phone) > 30) fail(`${n}번째 전화번호는 30자 이하여야 합니다`);
    if (typeof start !== "number" || !Number.isInteger(start) || start < 1 || start > 999)
      fail(`${n}번째 시작 번호는 1~999 정수여야 합니다`);

    const display = title === "" ? name : `${name} ${title}`;
    return { id, name, title, phone, start, display };
  });
}

let cache: { raw: string; list: StaffProfile[] } | null = null;

/** process.env.STAFF_CONFIG 를 읽는다. 값이 같으면 이전 결과를 재사용한다. */
export function loadStaff(): StaffProfile[] {
  const raw = process.env.STAFF_CONFIG;
  if (!raw) fail("설정되지 않았습니다");
  if (cache && cache.raw === raw) return cache.list;
  const list = parseStaffConfig(raw);
  cache = { raw, list };
  return list;
}
