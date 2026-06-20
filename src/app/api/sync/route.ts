import {
  guardApiRequest,
  rateLimitHeaders,
} from "@/lib/api-security";
import {
  internalErrorResponse,
  reportServerError,
} from "@/lib/server-errors";
import { syncKnowledgeBase } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const guard = guardApiRequest(request, "sync", {
    limit: 3,
    windowMs: 60 * 60 * 1000,
  });
  if ("response" in guard) {
    return guard.response;
  }

  if (process.env.VERCEL === "1") {
    return Response.json(
      {
        ok: false,
        error: "线上索引为只读快照，请通过发布任务更新。",
      },
      { status: 409 }
    );
  }

  try {
    const index = await syncKnowledgeBase();
    return Response.json(
      {
        ok: true,
        sync: index.sync,
      },
      { headers: rateLimitHeaders(guard.rateLimit) }
    );
  } catch (error) {
    reportServerError("sync", error, requestId);
    return internalErrorResponse(requestId);
  }
}
