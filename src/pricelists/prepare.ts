// 변환 결과를 generated/pricelists/ 에 쓴다 (빌드 전 단계에서만 사용).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AccessCatalog } from "@/domain/types";
import type { ParsedProductCatalog } from "./catalog";

export const GENERATED_DIR = path.join("generated", "pricelists");

/** 폴더를 비우고 access.json, catalog.json(+images 목록), images/<id>.<ext> 를 쓴다. */
export function writePricelists(outDir: string, access: AccessCatalog, product: ParsedProductCatalog): void {
  rmSync(outDir, { recursive: true, force: true });
  const imageDir = path.join(outDir, "images");
  mkdirSync(imageDir, { recursive: true });
  const files: Record<string, string> = {};
  for (const [id, img] of product.images) {
    const file = `${id}.${img.ext}`;
    writeFileSync(path.join(imageDir, file), img.data);
    files[id] = file;
  }
  writeFileSync(path.join(outDir, "access.json"), JSON.stringify(access));
  writeFileSync(path.join(outDir, "catalog.json"), JSON.stringify({ ...product.catalog, images: files }));
}
