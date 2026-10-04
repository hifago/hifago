import Link from "next/link";
import { notFound } from "next/navigation";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { SlotAvailabilityGrid } from "@/components/slot-availability-grid";
import { addDays } from "@/lib/products/dates";
import {
  loadSlotAvailabilityPageData,
  SLOT_AVAILABILITY_WINDOW_DAYS,
} from "@/lib/products/slotAvailabilityPage";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";

export default async function ProductSlotAvailabilityPage({
  params,
  searchParams,
}: PageProps<"/admin/products/[id]/slot-availability">) {
  // Pas un UUID → 404 avant toute lecture : la lecture, qui lève sur erreur, afficherait sinon
  // l'écran d'erreur pour une faute de frappe dans l'URL.
  const id = requireUuidParam((await params).id);
  const { from: fromParam } = await searchParams;

  // RLS (products_select_public) : l'admin voit aussi les fiches non publiées.
  const data = await loadSlotAvailabilityPageData(id, fromParam);

  if (!data) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Cupos por horario —{" "}
          {resolveLocalizedField(asLocalizedField(data.productName), "es") ?? id}
        </h1>
        <div className="flex gap-2">
          <Link
            href={`?from=${addDays(data.from, -SLOT_AVAILABILITY_WINDOW_DAYS)}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            data-testid="slot-availability-prev"
          >
            ← Anterior
          </Link>
          <Link
            href={`?from=${addDays(data.from, SLOT_AVAILABILITY_WINDOW_DAYS)}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            data-testid="slot-availability-next"
          >
            Siguiente →
          </Link>
        </div>
      </div>
      <SlotAvailabilityGrid productId={id} dates={data.dates} slots={data.slots} />
    </div>
  );
}
