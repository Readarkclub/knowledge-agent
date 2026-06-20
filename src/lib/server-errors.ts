const SECRET_PATTERNS = [
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /([?&](?:token|key|api_key|apikey|signature|secret|password)=)[^&\s]+/gi,
  /((?:api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|token|password)\s*[:=]\s*)[^\s,;]+/gi,
];

export function redactSensitiveText(value: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, "$1[REDACTED]"),
    value
  );
}

export function reportServerError(
  scope: string,
  error: unknown,
  requestId: string
): void {
  const message =
    error instanceof Error ? error.message : "Unknown server error";
  process.stderr.write(
    `[knowledge-error] ${JSON.stringify({
      scope,
      requestId,
      error: redactSensitiveText(message).slice(0, 400),
    })}\n`
  );
}

export function internalErrorResponse(requestId: string): Response {
  return Response.json(
    {
      error: "服务暂时不可用，请稍后重试。",
      requestId,
    },
    { status: 500 }
  );
}
