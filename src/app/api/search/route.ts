import {
  isLatestWeeklyReportQuery,
  latestWeeklyReportSources,
} from "@/lib/reports";
import { searchKnowledge } from "@/lib/search";
import { readIndex } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { query?: string };
  const query = body.query?.trim();

  if (!query) {
    return Response.json({ error: "缺少 query" }, { status: 400 });
  }

  const index = await readIndex();
  const results = isLatestWeeklyReportQuery(query)
    ? latestWeeklyReportSources(index, query)
    : await searchKnowledge(index, query);
  return Response.json({ results, sync: index.sync });
}
