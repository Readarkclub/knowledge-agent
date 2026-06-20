import {
  guardApiRequest,
  rateLimitHeaders,
} from "@/lib/api-security";
import {
  isLatestWeeklyReportQuery,
  isRecentWeeklyReportListQuery,
  isWeeklyReportCountQuery,
  isWeeklyReportListQuery,
  latestWeeklyReportSources,
  parseMonthFilter,
  parseRecentWeeklyReportLimit,
  recentWeeklyReportListSources,
  weeklyReportListSources,
} from "@/lib/reports";
import {
  parseJsonRequest,
  searchRequestSchema,
} from "@/lib/request-validation";
import { searchKnowledge } from "@/lib/search";
import {
  internalErrorResponse,
  reportServerError,
} from "@/lib/server-errors";
import { readIndex } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const guard = guardApiRequest(request, "search", {
      limit: 60,
      windowMs: 60 * 1000,
    });
    if ("response" in guard) {
      return guard.response;
    }

    const parsed = await parseJsonRequest(request, searchRequestSchema, 2_048);
    if ("response" in parsed) {
      return parsed.response;
    }
    const { query } = parsed.data;

    const index = await readIndex();
    const monthFilter = parseMonthFilter(query);
    const recentReportLimit = parseRecentWeeklyReportLimit(query);
    const isMonthlyReportQuery =
      isWeeklyReportCountQuery(query) || isWeeklyReportListQuery(query);
    const results =
      recentReportLimit && isRecentWeeklyReportListQuery(query)
        ? recentWeeklyReportListSources(index, recentReportLimit)
        : monthFilter && isMonthlyReportQuery
          ? weeklyReportListSources(index, monthFilter)
          : isLatestWeeklyReportQuery(query)
            ? latestWeeklyReportSources(index, query)
            : await searchKnowledge(index, query);

    return Response.json(
      { results, sync: index.sync },
      { headers: rateLimitHeaders(guard.rateLimit) }
    );
  } catch (error) {
    reportServerError("search", error, requestId);
    return internalErrorResponse(requestId);
  }
}
