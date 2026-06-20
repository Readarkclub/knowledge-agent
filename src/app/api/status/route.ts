import {
  guardApiRequest,
  rateLimitHeaders,
} from "@/lib/api-security";
import {
  internalErrorResponse,
  reportServerError,
} from "@/lib/server-errors";
import { readIndex } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const guard = guardApiRequest(request, "status", {
      limit: 120,
      windowMs: 60 * 1000,
    });
    if ("response" in guard) {
      return guard.response;
    }

    const index = await readIndex();
    return Response.json(
      {
        sync: {
          status: index.sync.status,
          completedAt: index.sync.completedAt,
          documentCount: index.sync.documentCount,
          chunkCount: index.sync.chunkCount,
          embeddedChunkCount: index.sync.embeddedChunkCount,
        },
        resources: index.resources.length,
        runtime: process.env.VERCEL === "1" ? "vercel-snapshot" : "local",
      },
      { headers: rateLimitHeaders(guard.rateLimit) }
    );
  } catch (error) {
    reportServerError("status", error, requestId);
    return internalErrorResponse(requestId);
  }
}
