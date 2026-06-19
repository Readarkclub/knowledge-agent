import { syncKnowledgeBase } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  if (process.env.VERCEL === "1") {
    return Response.json(
      {
        ok: false,
        error: "线上索引为只读快照，请通过周五发布任务更新。",
      },
      { status: 409 }
    );
  }

  try {
    const index = await syncKnowledgeBase();
    return Response.json({
      ok: true,
      sync: index.sync,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
