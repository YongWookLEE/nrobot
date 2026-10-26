// 실제 가격표(private/prices)와 기존 Python 결과(private/golden)가 있을 때만 도는 검사.
// 실패 메시지에 단가 등 실제 값이 찍히지 않도록 다른 항목 위치와 필드 이름만 알린다.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { parseAccessCatalog } from "@/pricelists/access";
import { parseProductCatalog } from "@/pricelists/catalog";
import { sizesClose, summarizeCatalog } from "./summary";

const root = process.cwd();
const accessPath = path.join(root, "private/prices/access.xlsx");
const catalogPath = path.join(root, "private/prices/catalog.xlsx");
const goldenPath = path.join(root, "private/golden/pricelists.json");
const ready = existsSync(accessPath) && existsSync(catalogPath) && existsSync(goldenPath);

function differingFields(actual: Record<string, unknown>, expected: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((f) => !isDeepStrictEqual(actual[f], expected[f]));
}

describe.skipIf(!ready)("실제 가격표 (private) = 기존 결과", () => {
  it("출입통제 항목이 기존 결과와 같다", () => {
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    const access = parseAccessCatalog(readFileSync(accessPath));
    expect(access.entries.length).toBe(golden.access.entries.length);
    const problems: string[] = [];
    access.entries.forEach((e, i) => {
      const bad = differingFields(e as unknown as Record<string, unknown>, golden.access.entries[i], Object.keys(golden.access.entries[i]));
      if (bad.length) problems.push(`${i}번: ${bad.join(",")}`);
    });
    expect(problems).toEqual([]);
    expect(access.revision === golden.access.revision).toBe(true);
  });

  it("제품 항목·id·단가·경고·조건·시트·사진이 기존 결과와 같다", async () => {
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    const { catalog, images } = await parseProductCatalog(readFileSync(catalogPath));
    const summary = summarizeCatalog(catalog, images.size);
    expect(summary.entries.length).toBe(golden.catalog.entries.length);
    expect(isDeepStrictEqual(summary.sheets, golden.catalog.sheets)).toBe(true);
    expect(summary.imageCount).toBe(golden.catalog.imageCount);
    expect(summary.warnings.length).toBe(golden.catalog.warnings.length);
    expect(isDeepStrictEqual(summary.warnings, golden.catalog.warnings)).toBe(true);
    const fields = Object.keys(golden.catalog.entries[0] ?? {}).filter((f) => f !== "template");
    const problems: string[] = [];
    summary.entries.forEach((e, i) => {
      const want = golden.catalog.entries[i];
      const bad = differingFields(e as unknown as Record<string, unknown>, want, fields);
      const { imageSizes, ...template } = e.template;
      const { imageSizes: wantSizes, ...wantTemplate } = want.template;
      if (!isDeepStrictEqual(template, wantTemplate)) bad.push("template");
      if (!sizesClose(imageSizes, wantSizes)) bad.push("imageSizes");
      if (bad.length) problems.push(`${i}번(${e.sheet}!${e.row}): ${bad.join(",")}`);
    });
    expect(problems).toEqual([]);
  });
});
