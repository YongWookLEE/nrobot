// 서버 전용: 빌드 전 단계가 만든 generated/pricelists 를 읽는다 (Node fs 사용, 화면 코드에서 가져오지 않는다).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AccessCatalog, ProductCatalog } from "@/domain/types";

export const MISSING_GENERATED = "가격표 변환 데이터가 없습니다. npm run prepare-data 를 실행하세요.";

export type StoredProductCatalog = ProductCatalog & { images: Record<string, string> };

export interface LoadedImage {
  data: Buffer;
  ext: "jpg" | "png";
  contentType: "image/jpeg" | "image/png";
}

export interface PricelistLoader {
  loadAccessCatalog(): AccessCatalog;
  loadProductCatalog(): StoredProductCatalog;
  /** 없는 id면 null */
  loadCatalogImage(id: string): LoadedImage | null;
}

export function createLoader(dir: string): PricelistLoader {
  let access: AccessCatalog | null = null;
  let product: StoredProductCatalog | null = null;
  const images = new Map<string, LoadedImage>();

  const readJson = <T>(file: string): T => {
    const p = path.join(dir, file);
    if (!existsSync(p)) throw new Error(MISSING_GENERATED);
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch {
      throw new Error(MISSING_GENERATED);
    }
  };

  const loader: PricelistLoader = {
    loadAccessCatalog() {
      access ??= readJson<AccessCatalog>("access.json");
      return access;
    },
    loadProductCatalog() {
      product ??= readJson<StoredProductCatalog>("catalog.json");
      return product;
    },
    loadCatalogImage(id) {
      const cached = images.get(id);
      if (cached) return cached;
      const file = Object.prototype.hasOwnProperty.call(loader.loadProductCatalog().images, id)
        ? loader.loadProductCatalog().images[id]
        : undefined;
      if (!file || !/^[0-9a-f]{64}\.(jpg|png)$/.test(file)) return null;
      const p = path.join(dir, "images", file);
      if (!existsSync(p)) return null;
      const ext = file.endsWith(".png") ? "png" : "jpg";
      const img: LoadedImage = { data: readFileSync(p), ext, contentType: ext === "png" ? "image/png" : "image/jpeg" };
      images.set(id, img);
      return img;
    },
  };
  return loader;
}

let defaultLoader: PricelistLoader | null = null;
function getDefault(): PricelistLoader {
  defaultLoader ??= createLoader(path.join(process.cwd(), "generated", "pricelists"));
  return defaultLoader;
}

export const loadAccessCatalog = (): AccessCatalog => getDefault().loadAccessCatalog();
export const loadProductCatalog = (): StoredProductCatalog => getDefault().loadProductCatalog();
export const loadCatalogImage = (id: string): LoadedImage | null => getDefault().loadCatalogImage(id);
