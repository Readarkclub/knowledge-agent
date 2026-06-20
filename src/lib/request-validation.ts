import { z } from "zod";

const textPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(8_000),
  })
  .passthrough();

const messageSchema = z
  .object({
    id: z.string().min(1).max(160).optional(),
    role: z.enum(["user", "assistant"]),
    parts: z.array(textPartSchema).min(1).max(20),
  })
  .passthrough();

export const chatRequestSchema = z
  .object({
    id: z.string().min(1).max(160).optional(),
    messages: z.array(messageSchema).min(1).max(24),
    trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
    messageId: z.string().min(1).max(160).optional(),
  })
  .strict()
  .superRefine(({ messages }, context) => {
    const totalLength = messages.reduce(
      (sum, message) =>
        sum +
        message.parts.reduce((partSum, part) => partSum + part.text.length, 0),
      0
    );
    if (totalLength > 32_000) {
      context.addIssue({
        code: "custom",
        message: "会话内容过长",
        path: ["messages"],
      });
    }
    if (messages.at(-1)?.role !== "user") {
      context.addIssue({
        code: "custom",
        message: "最后一条消息必须来自用户",
        path: ["messages"],
      });
    }
  });

export const searchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
  })
  .strict();

export const loginRequestSchema = z
  .object({
    username: z.string().trim().min(1).max(80),
    password: z.string().min(1).max(256),
  })
  .strict();

export async function parseJsonRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 64 * 1024
): Promise<{ data: T } | { response: Response }> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) {
    return {
      response: Response.json(
        { error: "请求必须使用 application/json。" },
        { status: 415 }
      ),
    };
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      response: Response.json({ error: "请求内容过大。" }, { status: 413 }),
    };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      response: Response.json({ error: "无法读取请求内容。" }, { status: 400 }),
    };
  }

  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return {
      response: Response.json({ error: "请求内容过大。" }, { status: 413 }),
    };
  }

  try {
    const result = schema.safeParse(JSON.parse(raw));
    if (!result.success) {
      return {
        response: Response.json({ error: "请求参数不合法。" }, { status: 400 }),
      };
    }
    return { data: result.data };
  } catch {
    return {
      response: Response.json({ error: "JSON 格式不正确。" }, { status: 400 }),
    };
  }
}
