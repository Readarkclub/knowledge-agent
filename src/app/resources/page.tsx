import { ResourceIndex } from "@/components/resource-index";
import { requireAuthenticatedPage } from "@/lib/page-auth";
import { readIndex } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  await requireAuthenticatedPage();
  const index = await readIndex();

  return (
    <ResourceIndex
      resources={index.resources}
      sourceUrl={index.source.rootUrl}
      sync={index.sync}
    />
  );
}
