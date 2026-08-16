import { Card, CardHeader, EmptyState, InfoBanner } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { PriceListItem } from "@/lib/types";
import { PriceListManager } from "./price-list-manager";

export const dynamic = "force-dynamic";

export default async function PriceListPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from("price_list_items")
    .select("*")
    .order("sort_order")
    .order("name");

  const items = (data ?? []) as PriceListItem[];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Price list</h1>
        <p className="mt-1 text-sm text-slate-600">
          What the customer is charged per work item, and how that splits. Job totals
          are built from these.
        </p>
      </div>

      <InfoBanner>
        Changing a rate here affects future jobs only. Every job keeps its own copy of
        the description and rate it was priced at, so what a contractor accepted can
        never be altered after the fact.
      </InfoBanner>

      {items.length === 0 ? (
        <Card>
          <CardHeader title="No work items yet" />
          <EmptyState
            title="Add your first work item"
            description="Start with the jobs you quote most often."
          />
        </Card>
      ) : null}

      <PriceListManager items={items} />
    </div>
  );
}
