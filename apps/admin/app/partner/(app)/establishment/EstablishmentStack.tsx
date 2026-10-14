import Link from "next/link";
import { buttonVariants } from "@hifago/ui";
import { CatalogCard, type CatalogCardStatus } from "@/components/catalog-card";
import { ESTABLISHMENT_STATUS_LABELS } from "@/lib/lists/filters";
import { EstablishmentActivities, type PendingProductCreationRow, type ProductCardRow } from "./EstablishmentActivities";

export type EstablishmentCardRow = {
  id: string;
  name: string;
  status: string;
  pendingEdit: boolean;
  photos: { id: string; url: string; alt: string }[];
};

const STATUS_CHIP_COLOR: Record<string, CatalogCardStatus["color"]> = {
  active: "success",
  archived: "default",
};

// Remplace EstablishmentsGrid.tsx + ProductsGrid.tsx (refonte vue prestataire, 2026-08-19) : pour
// chaque établissement, une carte pleine largeur (rendue seule, hors CatalogCardGrid — demande
// explicite "une carte qui prenne toute la longueur") suivie de la grille de ses activités liées
// juste dessous ("en dessous des plus petites sur les activités et autres").
export function EstablishmentStack({
  establishment,
  products,
  pendingProductCreations,
}: {
  establishment: EstablishmentCardRow;
  products: ProductCardRow[];
  pendingProductCreations: PendingProductCreationRow[];
}) {
  // Même règle "un seul tag à la fois" que EstablishmentsGrid.tsx : "en révision" prend le pas sur
  // activo/archivado plutôt que s'y ajouter.
  const statusChips: CatalogCardStatus[] = establishment.pendingEdit
    ? [{ label: "Edición pendiente de revisión", color: "warning", testId: "pending-edit-badge" }]
    : [
        {
          label: ESTABLISHMENT_STATUS_LABELS[establishment.status] ?? establishment.status,
          color: STATUS_CHIP_COLOR[establishment.status] ?? "default",
        },
      ];

  return (
    <div className="flex flex-col gap-4" data-testid={`establishment-stack-${establishment.id}`}>
      <CatalogCard
        testId={`establishment-row-${establishment.id}`}
        layout="horizontal"
        photos={establishment.photos}
        title={establishment.name}
        statusChips={statusChips}
        footer={
          <Link
            href={`/partner/establishment/${establishment.id}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            data-testid={`edit-establishment-link-${establishment.id}`}
          >
            Editar
          </Link>
        }
      />

      {/* Les titres de section (Actividades, Alojamientos, Eventos…) sont rendus par
          EstablishmentActivities, un par type de produit présent. */}
      <div className="pl-0 md:pl-4">
        <EstablishmentActivities
          establishmentId={establishment.id}
          products={products}
          pendingCreations={pendingProductCreations}
        />
      </div>
    </div>
  );
}
