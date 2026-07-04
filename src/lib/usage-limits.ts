import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { checkBotId } from "botid/server";
import {
  consumeRateLimit,
  isSameOriginRequest,
  isSecureRequest,
  rateLimitHeaders,
  rateLimitResponse,
  requestFingerprint,
  type RateLimitResult,
} from "@/lib/api-security";
import {
  getOrCreateVisitor,
  isVisitorSessionConfigured,
  serializeVisitorCookie,
} from "@/lib/visitor";

type ProtectedScope = "chat" | "search";
type QuotaKind = "minute" | "daily" | "fingerprintDaily" | "globalDaily";

type UsagePolicy = {
  minute: number;
  daily: number;
  fingerprintDaily: number;
  globalDaily: number;
};

type QuotaRule = {
  kind: QuotaKind;
  identifier: string;
  limit: number;
  window: "1 m" | "1 d";
};

export type UsageAccess = {
  headers: Headers;
};

type UsageGuardResult =
  | { response: Response }
  | {
      access: UsageAccess;
    };

const DEFAULT_POLICIES: Record<ProtectedScope, UsagePolicy> = {
  chat: {
    minute: 5,
    daily: 30,
    fingerprintDaily: 60,
    globalDaily: 500,
  },
  search: {
    minute: 30,
    daily: 300,
    fingerprintDaily: 600,
    globalDaily: 5_000,
  },
};

const distributedLimiters = new Map<string, Ratelimit>();

function configuredLimit(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getUsagePolicy(scope: ProtectedScope): UsagePolicy {
  const defaults = DEFAULT_POLICIES[scope];
  const prefix = scope.toUpperCase();
  return {
    minute: configuredLimit(`${prefix}_MINUTE_LIMIT`, defaults.minute),
    daily: configuredLimit(`${prefix}_DAILY_LIMIT`, defaults.daily),
    fingerprintDaily: configuredLimit(
      `${prefix}_FINGERPRINT_DAILY_LIMIT`,
      defaults.fingerprintDaily
    ),
    globalDaily: configuredLimit(
      `${prefix}_GLOBAL_DAILY_LIMIT`,
      defaults.globalDaily
    ),
  };
}

function hasRedisConfiguration(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN ||
        process.env.KV_REST_API_TOKEN)
  );
}

function getDistributedLimiter(
  key: string,
  limit: number,
  window: "1 m" | "1 d"
): Ratelimit {
  const cacheKey = `${key}:${limit}:${window}`;
  const existing = distributedLimiters.get(cacheKey);
  if (existing) {
    return existing;
  }

  const limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter:
      window === "1 m"
        ? Ratelimit.slidingWindow(limit, window)
        : Ratelimit.fixedWindow(limit, window),
    analytics: false,
    prefix: `knowledge-agent:${key}`,
    timeout: 0,
  });
  distributedLimiters.set(cacheKey, limiter);
  return limiter;
}

async function checkQuota(
  request: Request,
  scope: ProtectedScope,
  rule: QuotaRule
): Promise<RateLimitResult> {
  if (!hasRedisConfiguration()) {
    return consumeRateLimit(
      request,
      `${scope}:${rule.kind}`,
      {
        limit: rule.limit,
        windowMs: rule.window === "1 m" ? 60_000 : 24 * 60 * 60 * 1000,
      },
      rule.identifier
    );
  }

  const result = await getDistributedLimiter(
    `${scope}:${rule.kind}`,
    rule.limit,
    rule.window
  ).limit(rule.identifier);
  return {
    allowed: result.success,
    limit: result.limit,
    remaining: result.remaining,
    resetAt: result.reset,
  };
}

function quotaResponse(
  scope: ProtectedScope,
  kind: QuotaKind,
  result: RateLimitResult
): Response {
  const retryAfter = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000)
  );

  if (kind === "globalDaily") {
    return Response.json(
      {
        error:
          scope === "chat"
            ? "今日公共问答额度已用完，请明天再试。"
            : "今日公共检索额度已用完，请明天再试。",
      },
      {
        status: 503,
        headers: {
          ...rateLimitHeaders(result),
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  if (kind === "daily" || kind === "fingerprintDaily") {
    return Response.json(
      {
        error:
          scope === "chat"
            ? "今日问答次数已用完，请明天再试。"
            : "今日检索次数已用完，请明天再试。",
      },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(result),
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  return rateLimitResponse(result);
}

export async function guardUsageRequest(
  request: Request,
  scope: ProtectedScope
): Promise<UsageGuardResult> {
  if (!isSameOriginRequest(request)) {
    return {
      response: Response.json(
        { error: "请求来源校验失败。" },
        { status: 403 }
      ),
    };
  }

  try {
    const verification = await checkBotId({
      advancedOptions: { checkLevel: "basic" },
    });
    if (verification.isBot) {
      return {
        response: Response.json(
          { error: "人机验证未通过，请使用正常浏览器重试。" },
          { status: 403 }
        ),
      };
    }
  } catch {
    return {
      response: Response.json(
        { error: "人机验证暂时不可用，请稍后重试。" },
        { status: 503 }
      ),
    };
  }

  if (
    !isVisitorSessionConfigured() ||
    (process.env.NODE_ENV === "production" && !hasRedisConfiguration())
  ) {
    return {
      response: Response.json(
        { error: "公共访问保护尚未配置，请联系管理员。" },
        { status: 503 }
      ),
    };
  }

  const visitor = getOrCreateVisitor(request);
  const policy = getUsagePolicy(scope);
  const rules: QuotaRule[] = [
    {
      kind: "minute",
      identifier: visitor.id,
      limit: policy.minute,
      window: "1 m",
    },
    {
      kind: "daily",
      identifier: visitor.id,
      limit: policy.daily,
      window: "1 d",
    },
    {
      kind: "fingerprintDaily",
      identifier: requestFingerprint(request),
      limit: policy.fingerprintDaily,
      window: "1 d",
    },
    {
      kind: "globalDaily",
      identifier: "all",
      limit: policy.globalDaily,
      window: "1 d",
    },
  ];

  const passed = new Map<QuotaKind, RateLimitResult>();
  try {
    for (const rule of rules) {
      const result = await checkQuota(request, scope, rule);
      if (!result.allowed) {
        return { response: quotaResponse(scope, rule.kind, result) };
      }
      passed.set(rule.kind, result);
    }
  } catch {
    return {
      response: Response.json(
        { error: "访问配额服务暂时不可用，请稍后重试。" },
        { status: 503 }
      ),
    };
  }

  const minute = passed.get("minute")!;
  const daily = passed.get("daily")!;
  const headers = new Headers({
    ...rateLimitHeaders(minute),
    "X-DailyLimit-Limit": String(daily.limit),
    "X-DailyLimit-Remaining": String(daily.remaining),
    "X-DailyLimit-Reset": String(Math.ceil(daily.resetAt / 1000)),
  });
  if (visitor.token) {
    headers.append(
      "Set-Cookie",
      serializeVisitorCookie(visitor.token, isSecureRequest(request))
    );
  }

  return { access: { headers } };
}

export function applyUsageAccess(
  response: Response,
  access: UsageAccess
): Response {
  access.headers.forEach((value, key) => response.headers.append(key, value));
  return response;
}
