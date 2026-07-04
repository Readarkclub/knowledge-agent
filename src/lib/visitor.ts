import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const VISITOR_COOKIE_NAME = "knowledge_visitor";
export const VISITOR_TTL_SECONDS = 30 * 24 * 60 * 60;

type VisitorPayload = {
  id: string;
  exp: number;
};

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function visitorSecret(): string | null {
  const configured = process.env.VISITOR_SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) {
    return configured;
  }
  return process.env.NODE_ENV === "production"
    ? null
    : "local-development-visitor-secret-at-least-32-characters";
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function readCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return undefined;
  }

  for (const part of cookie.split(";")) {
    const [cookieName, ...value] = part.trim().split("=");
    if (cookieName === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return undefined;
}

export function isVisitorSessionConfigured(): boolean {
  return Boolean(visitorSecret());
}

export function createVisitorToken(
  visitorId: string,
  now = Date.now()
): string {
  const secret = visitorSecret();
  if (!secret) {
    throw new Error("VISITOR_SESSION_SECRET 未配置或长度不足 32 位");
  }

  const payload = encode(
    JSON.stringify({
      id: visitorId,
      exp: Math.floor(now / 1000) + VISITOR_TTL_SECONDS,
    } satisfies VisitorPayload)
  );
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyVisitorToken(
  token: string | undefined,
  now = Date.now()
): VisitorPayload | null {
  const secret = visitorSecret();
  if (!secret || !token) {
    return null;
  }

  const [payload, signature, extra] = token.split(".");
  if (
    !payload ||
    !signature ||
    extra ||
    !safeEqual(signature, sign(payload, secret))
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(decode(payload)) as VisitorPayload;
    if (
      !/^[0-9a-f-]{36}$/i.test(parsed.id) ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= Math.floor(now / 1000)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getOrCreateVisitor(request: Request): {
  id: string;
  token?: string;
} {
  const current = verifyVisitorToken(readCookie(request, VISITOR_COOKIE_NAME));
  if (current) {
    return { id: current.id };
  }

  const id = randomUUID();
  return { id, token: createVisitorToken(id) };
}

export function serializeVisitorCookie(
  token: string,
  secure: boolean
): string {
  return [
    `${VISITOR_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${VISITOR_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
