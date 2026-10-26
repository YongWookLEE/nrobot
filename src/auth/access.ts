import { verifySession } from "./session";

export type AccessDecision = "allow" | "redirect" | "unauthorized";

export const ENTER_PAGE = "/enter";
export const ENTER_API = "/api/enter";
export const UNAUTHORIZED_MESSAGE = "입장이 필요합니다. 화면을 새로고침해 주세요.";

/** 입장 없이 열 수 있는 정확한 경로 */
const PUBLIC_EXACT = new Set([ENTER_PAGE, `${ENTER_PAGE}/`, ENTER_API, `${ENTER_API}/`, "/favicon.ico"]);
/** 입장 페이지가 필요로 하는 빌드 정적 자원 */
const PUBLIC_PREFIXES = ["/_next/static/"];
/** 개발 서버 전용 내부 경로(HMR 등) */
const DEV_PREFIXES = ["/_next/webpack-hmr", "/__nextjs"];

function normalize(pathname: string): string {
  try {
    return new URL(pathname, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

export function isPublicPath(pathname: string, dev = false): boolean {
  const p = normalize(pathname);
  if (PUBLIC_EXACT.has(p)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  if (dev && DEV_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  return false;
}

export function isApiPath(pathname: string): boolean {
  const p = normalize(pathname);
  return p === "/api" || p.startsWith("/api/");
}

/**
 * 경로와 쿠키로 통과/입장 페이지로 보내기/401 을 정한다.
 * 비밀번호가 설정되지 않았거나 쿠키가 유효하지 않으면 막는다(fail closed).
 */
export async function decideAccess(input: {
  pathname: string;
  cookie: string | undefined;
  password: string | undefined;
  now?: number;
  dev?: boolean;
}): Promise<AccessDecision> {
  if (isPublicPath(input.pathname, input.dev)) return "allow";
  if (await verifySession(input.cookie, input.password, input.now ?? Date.now())) return "allow";
  return isApiPath(input.pathname) ? "unauthorized" : "redirect";
}
