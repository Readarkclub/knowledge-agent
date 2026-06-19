import { KnowledgeWorkspace } from "@/components/knowledge-workspace";
import { readIndex } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
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
