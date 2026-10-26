import { describe, expect, it, vi } from "vitest";
import { handleEnter, handleLeave } from "@/auth/enter";
import { SESSION_COOKIE, verifySession } from "@/auth/session";

function req(body: unknown, url = "http://localhost/api/enter") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("입장 처리", () => {
  it("비밀번호가 설정되지 않으면 항상 거부한다", async () => {
    for (const pw of [undefined, ""]) {
      const delay = vi.fn(async () => {});
      const res = await handleEnter(req({ password: "" }), { password: pw, delay });
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe("관리자가 비밀번호를 설정하지 않았습니다");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("틀린 비밀번호는 지연 후 401", async () => {
    const delay = vi.fn(async () => {});
    const res = await handleEnter(req({ password: "nope" }), { password: "test-pass", delay });
    expect(delay).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "비밀번호를 확인하세요" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("잘못된 요청 본문도 지연 후 401", async () => {
    const delay = vi.fn(async () => {});
    const res = await handleEnter(req("not json"), { password: "test-pass", delay });
    expect(delay).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it("맞는 비밀번호는 서명된 쿠키를 준다", async () => {
    const delay = vi.fn(async () => {});
    const now = 1_800_000_000_000;
    const res = await handleEnter(req({ password: "test-pass" }), {
      password: "test-pass",
      delay,
      now: () => now,
    });
    expect(delay).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain(`${SESSION_COOKIE}=`);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Max-Age=2592000/);
    expect(sc).toMatch(/Path=\//);
    const value = sc.split(";")[0].split("=").slice(1).join("=");
    expect(await verifySession(decodeURIComponent(value), "test-pass", now)).toBe(true);
  });

  it("운영 환경이나 https에서는 Secure를 붙인다", async () => {
    const delay = async () => {};
    const https = await handleEnter(req({ password: "p" }, "https://example.test/api/enter"), {
      password: "p",
      delay,
      production: false,
    });
    expect(https.headers.get("set-cookie")).toMatch(/Secure/i);
    const prod = await handleEnter(req({ password: "p" }), { password: "p", delay, production: true });
    expect(prod.headers.get("set-cookie")).toMatch(/Secure/i);
    const dev = await handleEnter(req({ password: "p" }), { password: "p", delay, production: false });
    expect(dev.headers.get("set-cookie")).not.toMatch(/Secure/i);
  });

  it("나가기는 쿠키를 지운다", async () => {
    const res = handleLeave(new Request("http://localhost/api/leave", { method: "POST" }), {
      production: false,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain(`${SESSION_COOKIE}=`);
    expect(sc).toMatch(/Max-Age=0/);
  });
});
