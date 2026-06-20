import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "knowledge_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

type SessionPayload = {
  sub: string;
  exp: number;
};

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function getAuthUsername(): string {
  return process.env.AUTH_USERNAME?.trim() || "admin";
}

export function getSessionSecret(): string | null {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_PASSWORD &&
      process.env.AUTH_PASSWORD.length >= 12 &&
      getSessionSecret()
  );
}

export function verifyCredentials(username: string, password: string): boolean {
  const expectedPassword = process.env.AUTH_PASSWORD;
  if (
    !expectedPassword ||
    expectedPassword.length < 12 ||
    !getSessionSecret()
  ) {
    return false;
  }

  return (
    safeEqual(username, getAuthUsername()) &&
    safeEqual(password, expectedPassword)
  );
}

export function createSessionToken(username: string): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("AUTH_SESSION_SECRET 未配置或长度不足 32 位");
  }

  const payload = encode(
    JSON.stringify({
      sub: username,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    } satisfies SessionPayload)
  );
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  const secret = getSessionSecret();
  if (!secret || !token) {
    return null;
  }

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload, secret))) {
    return null;
  }

  try {
    const parsed = JSON.parse(decode(payload)) as SessionPayload;
    if (
      parsed.sub !== getAuthUsername() ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readSessionCookie(request: Request): string | undefined {
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return undefined;
  }

  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(value.join("="));
    }
  }
  return undefined;
}

export function getAuthenticatedUser(request: Request): string | null {
  return verifySessionToken(readSessionCookie(request))?.sub || null;
}
