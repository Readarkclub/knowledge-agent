import { readIndex } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const index = await readIndex();
  return Response.json({
    source: index.source,
    sync: index.sync,
    resources: index.resources.length,
    runtime: process.env.VERCEL === "1" ? "vercel-snapshot" : "local",
  });
}
