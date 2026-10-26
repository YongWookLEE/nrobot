import { describe, expect, it } from "vitest";
import { signSession, verifySession, SESSION_MAX_AGE_SECONDS } from "@/auth/session";

const PW = "test-pass";
const NOW = 1_800_000_000_000;

describe("입장 쿠키 서명/검증", () => {
  it("올바르게 서명된 쿠키는 유효하다", async () => {
    const token = await signSession(PW, NOW);
    expect(await verifySession(token, PW, NOW + 1000)).toBe(true);
  });

  it("변조된 쿠키는 거부된다", async () => {
    const token = await signSession(PW, NOW);
    const [exp, sig] = token.split(".");
    const flipped = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
    expect(await verifySession(`${exp}.${flipped}`, PW, NOW)).toBe(false);
    // 만료 시각을 늘리는 변조
    expect(await verifySession(`${Number(exp) + 999999}.${sig}`, PW, NOW)).toBe(false);
    expect(await verifySession("garbage", PW, NOW)).toBe(false);
    expect(await verifySession("", PW, NOW)).toBe(false);
    expect(await verifySession(undefined, PW, NOW)).toBe(false);
  });

  it("만료된 쿠키는 거부된다", async () => {
    const token = await signSession(PW, NOW);
    const later = NOW + SESSION_MAX_AGE_SECONDS * 1000 + 1;
    expect(await verifySession(token, PW, later)).toBe(false);
  });

  it("비밀번호가 바뀌면 기존 쿠키는 무효가 된다", async () => {
    const token = await signSession(PW, NOW);
    expect(await verifySession(token, "new-pass", NOW)).toBe(false);
  });

  it("비밀번호가 비어 있으면 어떤 쿠키도 유효하지 않다", async () => {
    const token = await signSession(PW, NOW);
    expect(await verifySession(token, "", NOW)).toBe(false);
    expect(await verifySession(token, undefined, NOW)).toBe(false);
    await expect(signSession("", NOW)).rejects.toThrow();
  });

  it("유효기간 상수는 30일이다", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});
