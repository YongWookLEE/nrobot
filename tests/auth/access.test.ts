import { describe, expect, it } from "vitest";
import { decideAccess } from "@/auth/access";
import { signSession } from "@/auth/session";

const PW = "test-pass";
const NOW = 1_800_000_000_000;

function decide(pathname: string, cookie: string | undefined, ...pw: [string | undefined] | []) {
  const password = pw.length === 0 ? PW : pw[0];
  return decideAccess({ pathname, cookie, password, now: NOW });
}

describe("프록시 접근 판단", () => {
  it("입장 페이지와 입장 API, 정적 자원은 허용", async () => {
    for (const p of [
      "/enter",
      "/api/enter",
      "/_next/static/chunks/app.js",
      "/_next/static/css/a.css",
      "/favicon.ico",
    ]) {
      expect(await decide(p, undefined)).toBe("allow");
    }
  });

  it("쿠키 없이 페이지는 입장 페이지로, API는 401", async () => {
    expect(await decide("/", undefined)).toBe("redirect");
    expect(await decide("/quotes/1", undefined)).toBe("redirect");
    expect(await decide("/api/catalog", undefined)).toBe("unauthorized");
    expect(await decide("/api/leave", undefined)).toBe("unauthorized");
    expect(await decide("/api", undefined)).toBe("unauthorized");
  });

  it("비슷한 경로로 우회할 수 없다", async () => {
    expect(await decide("/enterx", undefined)).toBe("redirect");
    expect(await decide("/api/enterx", undefined)).toBe("unauthorized");
    expect(await decide("/api/enter/../catalog", undefined)).toBe("unauthorized");
    expect(await decide("/_next/image", undefined)).toBe("redirect");
    expect(await decide("/_next/static/../../api/catalog", undefined)).toBe("unauthorized");
  });

  it("유효한 쿠키가 있으면 허용", async () => {
    const cookie = await signSession(PW, NOW);
    expect(await decide("/", cookie)).toBe("allow");
    expect(await decide("/api/catalog", cookie)).toBe("allow");
  });

  it("이전 비밀번호로 서명된 쿠키는 거부", async () => {
    const cookie = await signSession("old-pass", NOW);
    expect(await decide("/", cookie)).toBe("redirect");
    expect(await decide("/api/catalog", cookie)).toBe("unauthorized");
  });

  it("비밀번호가 비어 있으면 입장 페이지/API 외에는 모두 차단", async () => {
    const cookie = await signSession(PW, NOW);
    for (const pw of ["", undefined]) {
      expect(await decide("/", cookie, pw)).toBe("redirect");
      expect(await decide("/api/catalog", cookie, pw)).toBe("unauthorized");
      expect(await decide("/enter", cookie, pw)).toBe("allow");
      expect(await decide("/api/enter", cookie, pw)).toBe("allow");
    }
  });
});
