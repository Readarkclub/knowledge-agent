import { ResourceIndex } from "@/components/resource-index";
import { readIndex } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const index = await readIndex();

  return (
    <ResourceIndex
      resources={index.resources}
      sourceUrl={index.source.rootUrl}
      sync={index.sync}
    />
  );
}
