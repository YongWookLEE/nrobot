// 가격표 변환(빌드 전 단계): private/prices/*.xlsx → generated/pricelists/
// 실제 단가는 출력하지 않는다. 개수와 크기만 알린다.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseAccessCatalog } from "../src/pricelists/access";
import { parseProductCatalog } from "../src/pricelists/catalog";
import { GENERATED_DIR, writePricelists } from "../src/pricelists/prepare";

const GUIDE = "배포가이드의 '비공개 자료 준비'를 확인하세요.";

async function main(): Promise<number> {
  const root = process.cwd();
  const inputs = { access: "private/prices/access.xlsx", catalog: "private/prices/catalog.xlsx" };
  for (const rel of Object.values(inputs)) {
    if (!existsSync(path.join(root, rel))) {
      console.error(`${rel} 파일이 없습니다. ${GUIDE}`);
      return 1;
    }
  }

  let access;
  try {
    access = parseAccessCatalog(readFileSync(path.join(root, inputs.access)));
  } catch (e) {
    console.error(`${inputs.access} 출입통제 기준가격표를 해석하지 못했습니다: ${(e as Error).message}`);
    return 1;
  }
  let product;
  try {
    product = await parseProductCatalog(readFileSync(path.join(root, inputs.catalog)));
  } catch (e) {
    console.error(`${inputs.catalog} 영업팀 제품가격표를 해석하지 못했습니다: ${(e as Error).message}`);
    return 1;
  }

  const out = path.join(root, GENERATED_DIR);
  try {
    writePricelists(out, access, product);
  } catch (e) {
    console.error(`${GENERATED_DIR} 폴더에 변환 결과를 쓰지 못했습니다: ${(e as Error).message}`);
    return 1;
  }
  let bytes = 0;
  for (const img of product.images.values()) bytes += img.data.length;
  console.log(`가격표 변환 완료: 출입통제 ${access.entries.length}개, 제품 ${product.catalog.entries.length}개, 사진 ${product.images.size}개(${(bytes / 1024 / 1024).toFixed(2)}MB)`);
  for (const w of product.catalog.warnings) console.warn(`경고: ${w}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`가격표 변환 중 오류가 났습니다: ${(e as Error).message}`);
    process.exit(1);
  },
);
