/**
 * 입장 쿠키 서명/검증.
 * Web Crypto(HMAC-SHA256)만 사용하므로 프록시와 Node 양쪽에서 동작한다.
 * 서명 키는 APP_PASSWORD 이므로 비밀번호가 바뀌면 기존 쿠키는 모두 무효가 된다.
 */

export const SESSION_COOKIE = "nrobot_session";
/** 쿠키 유효기간(초). 기본 30일. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const VERSION = "v1";
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** 길이가 같으면 내용과 무관하게 같은 시간이 걸리는 비교 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(password: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(sig);
}

/** 두 문자열을 SHA-256으로 고정 길이로 만든 뒤 상수 시간 비교 */
export async function passwordsMatch(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

/** 서명된 쿠키 값: `<만료 epoch 초>.<base64url 서명>` */
export async function signSession(password: string, nowMs: number = Date.now()): Promise<string> {
  if (!password) throw new Error("APP_PASSWORD가 설정되지 않았습니다");
  const exp = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS;
  const sig = await hmac(password, `${VERSION}.${exp}`);
  return `${exp}.${toBase64Url(sig)}`;
}

export async function verifySession(
  token: string | undefined | null,
  password: string | undefined | null,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!password || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expText, sigText] = parts;
  if (!/^\d{1,12}$/.test(expText)) return false;
  const exp = Number(expText);
  if (exp * 1000 <= nowMs) return false;
  const given = fromBase64Url(sigText);
  if (!given) return false;
  const expected = await hmac(password, `${VERSION}.${exp}`);
  return timingSafeEqual(given, expected);
}
