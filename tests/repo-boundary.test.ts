// 저장소 경계 검사 (spec 4·17절, 18절 5항): 개인정보·회사 자료가 git에 들어가지 않았는지 확인한다.
// 커밋된 파일(git ls-files)만 본다. 작업 폴더에만 있는 private/·.env는 대상이 아니다.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

/**
 * git 명령을 실행해 출력 문자열을 돌려준다.
 * @param {string[]} args git 인자
 * @returns {string} 표준 출력
 */
function git(args: string[]): string {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** 커밋 대상(추적 중) 파일 목록 */
const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);

/** 추적 중인 텍스트 파일에서 정규식에 맞는 문자열을 모두 찾는다 (이진 파일 제외). */
function grepTracked(pattern: string, fixed = false): string[] {
  try {
    return git(["grep", "-I", "-h", "-o", fixed ? "-F" : "-E", "-e", pattern]).split("\n").filter(Boolean);
  } catch (e) {
    // git grep은 찾은 것이 없으면 종료 코드 1을 낸다.
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

/** 저장소 예시·기준 데이터에 쓰는 가짜 휴대폰 번호 */
const FAKE_PHONE = /^010-0000-000\d$|^010-1111-2222$/;

/**
 * 로컬 .env(있으면)와 환경 변수의 STAFF_CONFIG에서 실제 담당자 이름·휴대폰을 읽는다. 없으면 빈 목록.
 * @returns {{names: string[], phones: string[]}} 실제 값
 */
function realStaff(): { names: string[]; phones: string[] } {
  const sources: string[] = [];
  if (process.env.STAFF_CONFIG) sources.push(process.env.STAFF_CONFIG);
  const envFile = path.join(root, ".env");
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("STAFF_CONFIG="));
    if (line) sources.push(line.slice("STAFF_CONFIG=".length));
  }
  const names = new Set<string>();
  const phones = new Set<string>();
  for (const source of sources) {
    try {
      for (const s of JSON.parse(source) as Array<{ name?: unknown; phone?: unknown }>) {
        if (typeof s.name === "string" && s.name.trim()) names.add(s.name.trim());
        if (typeof s.phone === "string" && s.phone.trim()) phones.add(s.phone.trim());
      }
    } catch {
      // 형식이 틀린 설정은 담당자 검사(tests/staff)가 맡는다.
    }
  }
  return { names: [...names], phones: [...phones] };
}

describe("저장소 경계", () => {
  it("비공개 자료·변환 산출물·환경 변수 파일이 추적되지 않는다", () => {
    const forbidden = tracked.filter(
      (f) =>
        f.startsWith("private/") ||
        f.startsWith("generated/") ||
        f.startsWith(".vercel/") ||
        f.startsWith(".dryforge/") ||
        (/(^|\/)\.env/.test(f) && f !== ".env.example"),
    );
    expect(forbidden).toEqual([]);
  });

  it("맑은 고딕 글꼴 파일이 없다", () => {
    expect(tracked.filter((f) => /malgun/i.test(path.basename(f)))).toEqual([]);
  });

  it("엑셀 파일은 합성 시험 자료(tests/fixtures)뿐이다", () => {
    expect(tracked.filter((f) => /\.xls[xm]?$/i.test(f) && !f.startsWith("tests/fixtures/"))).toEqual([]);
  });

  it("휴대폰 번호는 가짜 값만 있다", () => {
    const phones = [...new Set(grepTracked("01[016789]-?[0-9]{3,4}-?[0-9]{4}"))];
    expect(phones.filter((p) => !FAKE_PHONE.test(p))).toEqual([]);
  });

  it("실제 담당자 설정(.env가 있을 때)의 이름·휴대폰이 없다", () => {
    const { names, phones } = realStaff();
    const leaked = [...names, ...phones].filter((v) => grepTracked(v, true).length > 0);
    expect(leaked).toEqual([]);
  });
});
