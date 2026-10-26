// 실행: node tests/api/check-traces.mjs (먼저 next build).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
function files(route) {
  const trace = path.join(root, ".next/server/app/api", route, "route.js.nft.json");
  return new Set(JSON.parse(readFileSync(trace, "utf8")).files.map((file) => path.resolve(path.dirname(trace), file).toLowerCase()));
}
function contains(list, relative) {
  assert(list.has(path.join(root, relative).toLowerCase()), `서버 번들 포함 누락: ${relative}`);
}

const generate = files("generate");
for (const asset of [
  "private/fonts/malgun.ttf", "private/fonts/malgunbd.ttf",
  "assets/fonts/KoPubDotum-Medium.ttf", "assets/fonts/KoPubDotum-Bold.ttf",
  "assets/images/Image33.png", "assets/images/Image35.png", "assets/images/Image37.jpg",
  "assets/layout/base_layout.json", "generated/pricelists/catalog.json", "generated/pricelists/access.json",
]) contains(generate, asset);
const images = readdirSync(path.join(root, "generated/pricelists/images")).filter((file) => /\.(png|jpg)$/.test(file));
for (const route of ["generate", "catalog-image/[id]"]) {
  const trace = files(route);
  contains(trace, "generated/pricelists/catalog.json");
  for (const image of images) contains(trace, `generated/pricelists/images/${image}`);
}
for (const route of ["catalog", "access-catalog"]) {
  contains(files(route), "generated/pricelists/catalog.json");
  contains(files(route), "generated/pricelists/access.json");
}
console.log(`서버 번들 포함 확인 통과: 가격표 2개, 사진 ${images.length}개, 글꼴 4개, 로고 3개, 열 비율`);
