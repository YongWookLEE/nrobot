/**
 * '만들기' 처리 순서 (spec 9·14절).
 * 번호 확정 → 형식별 생성 요청 → 모두 성공하면 내려받기 → 그 뒤에 번호 기록 1회.
 * 하나라도 실패하면 내려받지도, 기록하지도 않는다. 실패한 생성은 번호를 쓰지 않은 것으로 친다.
 */
import { resolveQuoteNumber, type QuoteNumberStore } from "@/numbering";
import type { SaveFormat } from "./draft";

/** 서버가 만든 파일 하나 */
export interface GeneratedFile {
  name: string;
  blob: Blob;
}

/** 생성 요청에 필요한 값 */
export interface GenerateJob {
  date: string;
  staffId: string;
  /** 직접 입력 번호면 그 번호, 자동이면 undefined */
  manualNumber?: string;
  saveFormat: SaveFormat;
  /** 확정된 번호와 형식으로 요청 본문을 만든다 */
  body(format: "pdf" | "xlsx", number: string): Record<string, unknown>;
}

const GENERIC_ERROR = "견적서를 만들지 못했습니다.";

/**
 * 저장 형식을 요청할 파일 형식 목록으로 바꾼다.
 * @param {SaveFormat} saveFormat 화면의 저장 형식
 * @returns {Array<"pdf" | "xlsx">} 요청 순서
 */
export function formatsOf(saveFormat: SaveFormat): Array<"pdf" | "xlsx"> {
  return saveFormat === "both" ? ["pdf", "xlsx"] : [saveFormat];
}

/**
 * 응답 헤더에서 내려받을 파일 이름을 읽는다. filename* (UTF-8)을 우선한다.
 * @param {string | null} header Content-Disposition 값
 * @param {string} fallback 읽지 못했을 때 이름
 * @returns {string} 파일 이름
 */
export function filenameFrom(header: string | null, fallback: string): string {
  const star = header ? /filename\*=UTF-8''([^;]+)/i.exec(header) : null;
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * 견적서를 만든다. 성공하면 save로 파일을 넘긴 뒤 번호를 한 번 기록한다.
 * @param {GenerateJob} job 요청 값
 * @param {QuoteNumberStore} store 견적번호 경계
 * @param {(files: GeneratedFile[]) => void} save 받은 파일 저장(내려받기)
 * @param {typeof fetch} fetchImpl 요청 함수 (시험에서 바꿔 끼운다)
 * @returns {Promise<string>} 사용한 견적번호. 실패하면 한국어 오류 문구로 거부한다.
 */
export async function generateQuote(
  job: GenerateJob,
  store: QuoteNumberStore,
  save: (files: GeneratedFile[]) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const number = await resolveQuoteNumber(store, { date: job.date, staffId: job.staffId, manual: job.manualNumber });
  const files: GeneratedFile[] = [];
  for (const format of formatsOf(job.saveFormat)) {
    let response: Response;
    try {
      response = await fetchImpl("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job.body(format, number)),
      });
    } catch {
      throw new Error("서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw new Error(typeof data?.error === "string" ? data.error : GENERIC_ERROR);
    }
    files.push({ name: filenameFrom(response.headers.get("content-disposition"), `견적서.${format}`), blob: await response.blob() });
  }
  save(files);
  await store.record({ date: job.date, staffId: job.staffId, number, manual: job.manualNumber !== undefined });
  return number;
}
