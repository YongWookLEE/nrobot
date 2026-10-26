/**
 * 견적번호 경계 (spec 9절).
 * 화면은 QuoteNumberStore만 쓰고, 구현(브라우저·메모리·나중의 서버 DB)은 바꿔 끼운다.
 */
export * from "./types";
export * from "./rules";
export * from "./memory";
export * from "./browser";

import type { QuoteNumberStore } from "./types";

/**
 * 이번 생성에 쓸 번호를 정한다. 기록하지 않는다.
 * manual이 있으면 직접 입력 번호를 검사해 그대로 쓰고, 없으면 다음 자동 번호를 쓴다.
 * 파일 생성이 모두 성공하면 호출부가 store.record를 한 번 부른다.
 */
export async function resolveQuoteNumber(
  store: QuoteNumberStore,
  request: { date: string; staffId: string; manual?: string },
): Promise<string> {
  if (request.manual !== undefined) {
    await store.checkManual(request.manual);
    return request.manual;
  }
  return store.previewNext(request.date, request.staffId);
}
