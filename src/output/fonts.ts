// 서버 전용: 출력(PDF·Excel)에 쓰는 글꼴 파일 경로와 이름을 한곳에 둔다.
// 경로는 프로젝트 폴더(process.cwd()) 기준이다. 배포 번들 설정(outputFileTracingIncludes 등)은
// FONT_FILES 의 값을 그대로 포함하면 된다.
import { existsSync } from "node:fs";
import path from "node:path";
import { isCatalogType, type QuoteType } from "@/domain/types";

/** 프로젝트 폴더 기준 글꼴 파일 경로 */
export const FONT_FILES = {
  /** 맑은 고딕 보통 (저장소에 넣지 않는다) */
  malgun: "private/fonts/malgun.ttf",
  /** 맑은 고딕 굵게 (저장소에 넣지 않는다) */
  malgunBold: "private/fonts/malgunbd.ttf",
  /** KoPub돋움체 Medium (저장소) */
  kopubMedium: "assets/fonts/KoPubDotum-Medium.ttf",
  /** KoPub돋움체 Bold (저장소. 기존 PDF는 굵은 자리에도 Medium을 쓰므로 PDF에서는 쓰지 않는다) */
  kopubBold: "assets/fonts/KoPubDotum-Bold.ttf",
} as const;

export type FontFileKey = keyof typeof FONT_FILES;

/** 문서·엑셀에 적는 글꼴 이름 */
export const FONT_NAMES = {
  malgun: "맑은 고딕",
  kopubMedium: "KoPub돋움체 Medium",
  kopubBold: "KoPub돋움체 Bold",
} as const;

export const MALGUN_MISSING = "맑은 고딕 글꼴 파일(private/fonts)이 없습니다";
export const KOPUB_MISSING = "KoPub돋움체 글꼴 파일(assets/fonts)이 없습니다";

/** 글꼴 파일의 절대 경로 */
export function fontFilePath(key: FontFileKey, root: string = process.cwd()): string {
  return path.join(root, FONT_FILES[key]);
}

/** PDF 본문 글꼴 (보통·굵게 파일 경로) */
export interface PdfFontFiles {
  regular: string;
  bold: string;
}

/**
 * 견적서 종류별 PDF 글꼴.
 * ①②③ 맑은 고딕 보통·굵게, ④⑤ KoPub돋움체 Medium (굵은 자리도 Medium — 기존과 같다).
 * 맑은 고딕 파일이 없으면 오류를 낸다.
 */
export function pdfFontFiles(type: QuoteType, root: string = process.cwd()): PdfFontFiles {
  if (isCatalogType(type)) {
    const medium = fontFilePath("kopubMedium", root);
    if (!existsSync(medium)) throw new Error(KOPUB_MISSING);
    return { regular: medium, bold: medium };
  }
  const regular = fontFilePath("malgun", root);
  const bold = fontFilePath("malgunBold", root);
  if (!existsSync(regular) || !existsSync(bold)) throw new Error(MALGUN_MISSING);
  return { regular, bold };
}

/** 맑은 고딕 파일이 모두 있는지 (시험에서 건너뛰기 판단용) */
export function hasMalgunFonts(root: string = process.cwd()): boolean {
  return existsSync(fontFilePath("malgun", root)) && existsSync(fontFilePath("malgunBold", root));
}
