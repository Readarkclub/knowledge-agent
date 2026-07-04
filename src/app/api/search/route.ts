import {
  applyUsageAccess,
  guardUsageRequest,
} from "@/lib/usage-limits";
import {
  latestWeeklyReportSources,
  recentWeeklyReportListSources,
  routeWeeklyReportQuery,
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
    const guard = await guardUsageRequest(request, "search");
    if ("response" in guard) {
      return guard.response;
    }

    const parsed = await parseJsonRequest(request, searchRequestSchema, 2_048);
    if ("response" in parsed) {
      return parsed.response;
    }
    const { query } = parsed.data;

    const index = await readIndex();
    const reportRoute = routeWeeklyReportQuery(query);
    const results =
      reportRoute?.type === "recent-list"
        ? recentWeeklyReportListSources(index, reportRoute.limit)
        : reportRoute?.type === "monthly-count" ||
            reportRoute?.type === "monthly-list"
          ? weeklyReportListSources(index, reportRoute.filter)
          : reportRoute?.type === "total-count"
            ? recentWeeklyReportListSources(index, 12)
            : reportRoute?.type === "latest"
            ? latestWeeklyReportSources(index, query)
            : await searchKnowledge(index, query);

    return applyUsageAccess(
      Response.json({ results, sync: index.sync }),
      guard.access
    );
  } catch (error) {
    reportServerError("search", error, requestId);
    return internalErrorResponse(requestId);
  }
}
