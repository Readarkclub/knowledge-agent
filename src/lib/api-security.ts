import { createHash } from "node:crypto";
import { getAuthenticatedUser } from "@/lib/auth";

type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

type GuardResult =
  | { response: Response }
  | {
      user: string;
      rateLimit: RateLimitResult;
    };

const rateLimitStore = (
  globalThis as typeof globalThis & {
    __knowledgeRateLimitStore?: Map<string, RateLimitEntry>;
  }
).__knowledgeRateLimitStore ||= new Map<string, RateLimitEntry>();

function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function requestFingerprint(request: Request): string {
  return createHash("sha256")
    .update(`${clientAddress(request)}|${request.headers.get("user-agent") || ""}`)
    .digest("hex")
    .slice(0, 24);
}

export function consumeRateLimit(
  request: Request,
  scope: string,
  policy: RateLimitPolicy
): RateLimitResult {
  const now = Date.now();
  const key = `${scope}:${requestFingerprint(request)}`;
  const existing = rateLimitStore.get(key);
  const entry =
    !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + policy.windowMs }
      : existing;

  entry.count += 1;
  rateLimitStore.set(key, entry);

  if (rateLimitStore.size > 2_000) {
    for (const [storedKey, storedEntry] of rateLimitStore) {
      if (storedEntry.resetAt <= now) {
        rateLimitStore.delete(storedKey);
      }
    }
  }

  return {
    allowed: entry.count <= policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - entry.count),
    resetAt: entry.resetAt,
  };
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

export function rateLimitResponse(result: RateLimitResult): Response {
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return Response.json(
    { error: "请求过于频繁，请稍后重试。" },
    {
      status: 429,
      headers: {
        ...rateLimitHeaders(result),
        "Retry-After": String(retryAfter),
      },
    }
  );
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    const requestUrl = new URL(request.url);
    const protocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      requestUrl.protocol.replace(":", "");
    const acceptedOrigins = new Set([requestUrl.origin]);
    for (const hostHeader of ["host", "x-forwarded-host"]) {
      const host = request.headers
        .get(hostHeader)
        ?.split(",")[0]
        ?.trim();
      if (host) {
        acceptedOrigins.add(`${protocol}://${host}`);
      }
    }
    return acceptedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function isSecureRequest(request: Request): boolean {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProtocol) {
    return forwardedProtocol === "https";
  }

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function guardApiRequest(
  request: Request,
  scope: string,
  policy: RateLimitPolicy
): GuardResult {
  const user = getAuthenticatedUser(request);
  if (!user) {
    return {
      response: Response.json(
        { error: "登录已失效，请重新登录。" },
        { status: 401 }
      ),
    };
  }

  if (request.method !== "GET" && !isSameOriginRequest(request)) {
    return {
      response: Response.json(
        { error: "请求来源校验失败。" },
        { status: 403 }
      ),
    };
  }

  const rateLimit = consumeRateLimit(request, `${scope}:${user}`, policy);
  if (!rateLimit.allowed) {
    return { response: rateLimitResponse(rateLimit) };
  }

  return { user, rateLimit };
}
