import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAccessCatalog } from "@/pricelists/access";
import { parseProductCatalog } from "@/pricelists/catalog";
import { sizesClose, summarizeCatalog } from "./summary";

const root = process.cwd();
const golden = JSON.parse(readFileSync(path.join(root, "tests/golden/pricelists.json"), "utf8"));
const accessBuf = readFileSync(path.join(root, "tests/fixtures/access.xlsx"));
const catalogBuf = readFileSync(path.join(root, "tests/fixtures/catalog.xlsx"));

describe("출입통제 기준가격표 (합성 엑셀 = 기존 결과)", () => {
  it("항목과 revision이 골든과 같다", () => {
    const access = parseAccessCatalog(accessBuf);
    expect(access.entries).toEqual(golden.access.entries);
    expect(access.revision).toBe(golden.access.revision);
  });
});

describe("영업팀 제품가격표 (합성 엑셀 = 기존 결과)", () => {
  it("항목·시트·경고·사진 개수가 골든과 같다", async () => {
    const { catalog, images } = await parseProductCatalog(catalogBuf);
    const summary = summarizeCatalog(catalog, images.size);
    expect(summary.sheets).toEqual(golden.catalog.sheets);
    expect(summary.warnings).toEqual(golden.catalog.warnings);
    expect(summary.imageCount).toBe(golden.catalog.imageCount);
    expect(summary.entries.length).toBe(golden.catalog.entries.length);
    summary.entries.forEach((entry, i) => {
      const want = golden.catalog.entries[i];
      const { imageSizes, ...template } = entry.template;
      const { imageSizes: wantSizes, ...wantTemplate } = want.template;
      expect({ ...entry, template }).toEqual({ ...want, template: wantTemplate });
      expect(sizesClose(imageSizes, wantSizes)).toBe(true);
    });
  });

  it("사진 id는 사진 파일 내용의 sha256이고 품목의 imageIds·imageSizes와 맞는다", async () => {
    const { catalog, images } = await parseProductCatalog(catalogBuf);
    const { createHash } = await import("node:crypto");
    for (const [id, img] of images) {
      expect(createHash("sha256").update(img.data).digest("hex")).toBe(id);
      expect(["jpg", "png"]).toContain(img.ext);
    }
    for (const e of catalog.entries) {
      expect(Object.keys(e.template.imageSizes).sort()).toEqual([...e.imageIds].sort());
      for (const id of e.imageIds) expect(images.has(id)).toBe(true);
    }
  });

  it("revision은 같은 파일이면 매번 같다", async () => {
    const a = await parseProductCatalog(catalogBuf);
    const b = await parseProductCatalog(catalogBuf);
    expect(a.catalog.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(a.catalog.revision).toBe(b.catalog.revision);
  });
});
