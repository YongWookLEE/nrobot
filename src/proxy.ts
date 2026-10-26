import { NextResponse, type NextRequest } from "next/server";
import { decideAccess, ENTER_PAGE, UNAUTHORIZED_MESSAGE } from "@/auth/access";
import { SESSION_COOKIE } from "@/auth/session";

export async function proxy(request: NextRequest) {
  const decision = await decideAccess({
    pathname: request.nextUrl.pathname,
    cookie: request.cookies.get(SESSION_COOKIE)?.value,
    password: process.env.APP_PASSWORD,
    dev: process.env.NODE_ENV !== "production",
  });

  if (decision === "allow") return NextResponse.next();
  if (decision === "unauthorized") {
    return NextResponse.json({ error: UNAUTHORIZED_MESSAGE }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const url = request.nextUrl.clone();
  url.pathname = ENTER_PAGE;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // 빌드 정적 자원만 건너뛴다. 나머지(페이지, API, public 파일)는 모두 판단을 거친다.
  matcher: ["/((?!_next/static/).*)"],
};
