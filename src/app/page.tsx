import { KnowledgeWorkspace } from "@/components/knowledge-workspace";
import { requireAuthenticatedPage } from "@/lib/page-auth";
import { readIndex } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAuthenticatedPage();
  const index = await readIndex();
  const isVercel = process.env.VERCEL === "1";
  return (
    <KnowledgeWorkspace
      canSync={!isVercel}
      initialSync={index.sync}
      semanticSearchEnabled={!isVercel}
    />
  );
}
