// 골든(기존 Python 결과 요약)과 같은 모양으로 변환 결과를 요약한다.
// 사진 id는 비교하지 않으므로 품목별 사진 개수와 정렬한 표시 크기로 바꾼다.
import type { CatalogEntry, ProductCatalog } from "@/domain/types";

export interface SummaryEntry extends Omit<CatalogEntry, "imageIds" | "template"> {
  imageCount: number;
  template: Omit<CatalogEntry["template"], "imageSizes"> & { imageSizes: Array<[number, number]> };
}

export function summarizeEntry(e: CatalogEntry): SummaryEntry {
  const { imageIds, template, ...rest } = e;
  const sizes = Object.values(template.imageSizes)
    .map(([w, h]) => [w, h] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { ...rest, imageCount: imageIds.length, template: { ...template, imageSizes: sizes } };
}

export function summarizeCatalog(catalog: ProductCatalog, imageCount: number) {
  return {
    entries: catalog.entries.map(summarizeEntry),
    sheets: catalog.sheets,
    warnings: catalog.warnings,
    imageCount,
  };
}

/** 표시 크기는 골든이 소수 4자리로 반올림했으므로 그 오차 안에서 비교한다. */
export function sizesClose(actual: Array<[number, number]>, expected: Array<[number, number]>): boolean {
  if (actual.length !== expected.length) return false;
  return actual.every(([w, h], i) => Math.abs(w - expected[i][0]) < 1e-4 && Math.abs(h - expected[i][1]) < 1e-4);
}
