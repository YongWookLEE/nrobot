// 실행: npm run build:vercel  (= vercel build --prod + 결과물 검사)
// Vercel의 Next.js 빌드 도구는 프로젝트 맨 위의 .env* 파일을 모든 서버 함수에 그대로 넣는다.
// 이 PC에서 빌드해 올리는 방식(deploy --prebuilt)에서는 실제 비밀번호·담당자 정보가 함께 올라가므로,
// 빌드하는 동안만 .env* 파일을 .vercel/env-hold/ 로 옮겨 두고 끝나면 되돌린다.
// 운영 환경 변수는 Vercel 프로젝트 설정에 넣는다(docs/배포가이드.md 3절).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const hold = path.join(root, ".vercel", "env-hold");
/** 결과물에 들어가도 되는 환경 변수 예시 파일 (가짜 값) */
const ALLOWED_ENV = new Set([".env.example"]);

/**
 * 프로젝트 맨 위의 .env* 파일 이름 목록 (.env.example 제외).
 * @returns {string[]} 파일 이름
 */
function envFiles() {
  return readdirSync(root).filter((f) => (f === ".env" || f.startsWith(".env.")) && !ALLOWED_ENV.has(f) && statSync(path.join(root, f)).isFile());
}

/**
 * 빌드 결과물의 서버 함수가 포함하는 파일 경로 중 배포하면 안 되는 것을 찾는다.
 * @param {string} dir .vercel/output 경로
 * @returns {string[]} 문제 경로 ("함수: 파일")
 */
function forbiddenInOutput(dir) {
  const problems = [];
  const bad = (p) => {
    const name = p.split("/").pop() ?? "";
    return (
      ((name === ".env" || name.startsWith(".env.")) && !ALLOWED_ENV.has(name)) ||
      /(^|\/)private\/(prices|reference|compare|golden)\//.test(p) ||
      /\.xls[xm]?$/i.test(p) ||
      /(^|\/)\.vercel\//.test(p)
    );
  };
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === ".vc-config.json") {
        const map = JSON.parse(readFileSync(full, "utf8")).filePathMap ?? {};
        for (const key of Object.keys(map)) if (bad(key)) problems.push(`${path.relative(dir, d)}: ${key}`);
      } else if (bad(path.relative(dir, full))) problems.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return problems;
}

const moved = envFiles();
if (existsSync(hold) && readdirSync(hold).length) {
  console.error(`.vercel/env-hold/ 에 지난번에 옮긴 파일이 남아 있습니다. 프로젝트 폴더로 되돌린 뒤 다시 실행하세요.`);
  process.exit(1);
}
mkdirSync(hold, { recursive: true });
for (const f of moved) renameSync(path.join(root, f), path.join(hold, f));

let code;
try {
  const result = spawnSync("vercel", ["build", "--prod", ...process.argv.slice(2)], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  code = result.status ?? 1;
  if (result.error) console.error(`vercel 명령을 실행하지 못했습니다: ${result.error.message}`);
} finally {
  for (const f of moved) renameSync(path.join(hold, f), path.join(root, f));
  rmdirSync(hold);
}
if (code !== 0) process.exit(code);

const problems = forbiddenInOutput(path.join(root, ".vercel", "output"));
if (problems.length) {
  console.error(`빌드 결과물에 배포하면 안 되는 파일이 있습니다. 올리지 마세요:\n- ${[...new Set(problems)].slice(0, 20).join("\n- ")}`);
  process.exit(1);
}
console.log("빌드 결과물 확인 통과: 환경 변수 파일·가격표 원본·비공개 자료 없음. 이제 vercel deploy --prebuilt --prod 로 올릴 수 있습니다.");
