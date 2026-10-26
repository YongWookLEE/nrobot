// 개발용: 골든 입력 전부를 private/compare/new/{name}.pdf 로 그린다.
// 사용법 (프로젝트 폴더에서): npx tsx tests/output/pdf/render-compare.ts
import { hasMalgunFonts } from "@/output/fonts";
import { hasPrivate, renderAllForCompare } from "./helpers";

async function main(): Promise<void> {
  if (!hasPrivate()) {
    console.log("private/ 폴더가 없어 건너뜁니다.");
    return;
  }
  const results = await renderAllForCompare(!hasMalgunFonts());
  for (const r of results) console.log(`${r.name}\tpages=${r.pages}\ttotal=${r.total}\tscale=${r.scale.toFixed(4)}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
