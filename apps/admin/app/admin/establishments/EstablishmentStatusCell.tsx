"use client";

import { Chip } from "@hifago/ui";
import { StatusChip } from "@/components/status-chip";
import { ESTABLISHMENT_STATUS_CHIP_STYLE, ESTABLISHMENT_STATUS_LABELS } from "@/lib/lists/filters";
import type { EstablishmentRow } from "./EstablishmentsList";

// Revue admin établissements (Jérôme, 2026-08-19) — 3 signaux empilés dans la cellule "Estado"
// existante plutôt que 2 colonnes dédiées : le reflow mobile de DataList/SimpleTable met chaque
// cellule en ligne "libellé : valeur" sous md, empiler des chips y reste lisible sans toucher
// packages/ui ni dégrader la densité déjà tendue de cette liste. Sémantiques volontairement
// distinctes : statut principal (état de l'établissement) / proposition en attente (warning, une
// action de review attend l'admin, cliquable) / partenaire non opérationnel (danger, une
// incohérence de gouvernance à investiguer, informatif seul — aucune RPC de réactivation
// n'existe côté admin aujourd'hui).
export function EstablishmentStatusCell({ row }: { row: EstablishmentRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <StatusChip
        status={row.status}
        map={ESTABLISHMENT_STATUS_CHIP_STYLE}
        labels={ESTABLISHMENT_STATUS_LABELS}
        testId={`establishment-status-${row.id}`}
      />
      {row.pendingProposal ? (
        <a
          // `?entity=establishment` : sans lui, la page de modération cherche une proposition de
          // PRODUIT et répond 404 (même lien que l'e-mail notify_admin_new_proposal).
          href={`/admin/proposals/${row.pendingProposal.id}?entity=establishment`}
          data-testid={`pending-proposal-badge-${row.id}`}
        >
          <Chip variant="soft" color="warning">
            {row.pendingProposal.kind === "photos" ? "Fotos pendientes" : "Edición pendiente"}
          </Chip>
        </a>
      ) : null}
      {row.operatorInactive ? (
        <Chip variant="soft" color="danger" data-testid={`operator-inactive-badge-${row.id}`}>
          Prestador no operativo
        </Chip>
      ) : null}
    </div>
  );
}
