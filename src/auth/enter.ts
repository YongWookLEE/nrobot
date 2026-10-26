import { passwordsMatch, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } from "./session";

/** 틀린 비밀번호 응답 전 지연(ms) */
export const WRONG_PASSWORD_DELAY_MS = 1000;
export const NOT_CONFIGURED_MESSAGE = "관리자가 비밀번호를 설정하지 않았습니다";
export const WRONG_PASSWORD_MESSAGE = "비밀번호를 확인하세요";

export interface EnterOptions {
  password?: string;
  delay?: () => Promise<void>;
  now?: () => number;
  production?: boolean;
}

const defaultDelay = () => new Promise<void>((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));

function json(body: unknown, status: number, setCookie?: string): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function isSecure(request: Request, production: boolean | undefined): boolean {
  if (production ?? process.env.NODE_ENV === "production") return true;
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    // 무시
  }
  return request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
}

function cookieHeader(value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

async function readPassword(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "password" in body) {
      const pw = (body as { password: unknown }).password;
      if (typeof pw === "string") return pw;
    }
  } catch {
    // 잘못된 본문
  }
  return null;
}

/** POST /api/enter. 비밀번호 값은 어디에도 기록하지 않는다. */
export async function handleEnter(request: Request, options: EnterOptions = {}): Promise<Response> {
  const expected = "password" in options ? options.password : process.env.APP_PASSWORD;
  if (!expected) return json({ error: NOT_CONFIGURED_MESSAGE }, 503);

  const given = await readPassword(request);
  if (given === null || !(await passwordsMatch(given, expected))) {
    await (options.delay ?? defaultDelay)();
    return json({ error: WRONG_PASSWORD_MESSAGE }, 401);
  }

  const now = (options.now ?? Date.now)();
  const token = await signSession(expected, now);
  return json({ ok: true }, 200, cookieHeader(token, SESSION_MAX_AGE_SECONDS, isSecure(request, options.production)));
}

/** POST /api/leave: 쿠키를 지운다. */
export function handleLeave(request: Request, options: Pick<EnterOptions, "production"> = {}): Response {
  return json({ ok: true }, 200, cookieHeader("", 0, isSecure(request, options.production)));
}
