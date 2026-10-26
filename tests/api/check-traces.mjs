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
// 포함 검사만으로는 원본 가격표·비교 문서가 함께 들어간 과도한 추적을 놓친다.
const apiDir = path.join(root, ".next/server/app/api");
for (const entry of readdirSync(apiDir, { recursive: true })) {
  if (!entry.endsWith(".nft.json")) continue;
  const tracePath = path.join(apiDir, entry);
  for (const file of JSON.parse(readFileSync(tracePath, "utf8")).files) {
    const absolute = path.resolve(path.dirname(tracePath), file);
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    assert(relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative), "서버 번들에 프로젝트 외부 경로가 있습니다.");
    assert(!/^(?:\.dryforge|\.git|tests|tools)(?:\/|$)/i.test(relative), "서버 번들에 개발용 자료가 있습니다.");
    assert(!/^\.env(?:\.|$)/i.test(relative), "서버 번들에 환경 변수 원본이 있습니다.");
    assert(!/^private(?:\/|$)/i.test(relative) || /^private\/fonts\/[^/]+\.ttf$/i.test(relative), "서버 번들에 글꼴 외 비공개 원본 자료가 있습니다.");
  }
}
console.log(`서버 번들 포함 확인 통과: 가격표 2개, 사진 ${images.length}개, 글꼴 4개, 로고 3개, 열 비율`);
console.log("서버 번들 제외 확인 통과: 프로젝트 외부·비공개 원본·환경 변수·개발용 자료 없음");
