import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionToken,
  getAuthUsername,
  isAuthConfigured,
  verifyCredentials,
} from "@/lib/auth";
import {
  consumeRateLimit,
  isSameOriginRequest,
  isSecureRequest,
  rateLimitHeaders,
  rateLimitResponse,
} from "@/lib/api-security";
import {
  loginRequestSchema,
  parseJsonRequest,
} from "@/lib/request-validation";

export async function POST(request: Request) {
  const rateLimit = consumeRateLimit(request, "login", {
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "请求来源校验失败。" },
      { status: 403 }
    );
  }

  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "服务尚未配置登录凭证。" },
      { status: 503 }
    );
  }

  const parsed = await parseJsonRequest(request, loginRequestSchema, 2_048);
  if ("response" in parsed) {
    return parsed.response;
  }

  if (!verifyCredentials(parsed.data.username, parsed.data.password)) {
    return NextResponse.json(
      { error: "用户名或密码错误。" },
      {
        status: 401,
        headers: rateLimitHeaders(rateLimit),
      }
    );
  }

  const response = NextResponse.json(
    { ok: true },
    { headers: rateLimitHeaders(rateLimit) }
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken(getAuthUsername()),
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
