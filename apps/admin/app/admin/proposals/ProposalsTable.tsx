"use client";

import Link from "next/link";
import { formatDateInBogota } from "@hifago/domain";
import {
  buttonVariants,
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
} from "@hifago/ui";

type ProposalRow = {
  id: string;
  created_at: string;
  kind: string;
  entityType: "product" | "establishment";
  displayName: string;
  note: string | null;
  partner: { display_name: string } | null;
};

const KIND_LABELS: Record<string, string> = {
  content: "Contenido",
  photos: "Fotos",
  create: "Creación",
  edit: "Edición",
};

// Composant client dédié : Table.Body/Table.Content de HeroUI attendent des enfants sous forme de
// fonction (render prop) — non sérialisable à travers la frontière Server→Client Component.
// Fusion product_proposals ∪ establishment_proposals (docs/specs/06-gestion-etablissement.md) —
// même table, même écran, distingués par entityType pour router vers le bon détail (?entity=).
// Migré vers SimpleTable (reflow carte sous md) — colonne "actions" sans data-label, dégrade
// proprement (cf. docstring simple-table.tsx : header vide ⇒ pas de libellé affiché).
export function ProposalsTable({ proposals }: { proposals: ProposalRow[] }) {
  return (
    <SimpleTable aria-label="Propuestas pendientes">
      <SimpleTableHeader>
        <SimpleTableRow>
          <SimpleTableHead>Actividad / Establecimiento</SimpleTableHead>
          <SimpleTableHead>Tipo</SimpleTableHead>
          <SimpleTableHead>Partner</SimpleTableHead>
          <SimpleTableHead>Enviada</SimpleTableHead>
          <SimpleTableHead />
        </SimpleTableRow>
      </SimpleTableHeader>
      <SimpleTableBody>
        {proposals.length > 0 ? (
          proposals.map((proposal) => (
            <SimpleTableRow key={proposal.id} id={proposal.id} data-testid={`proposal-row-${proposal.id}`}>
              <SimpleTableCell data-label="Actividad / Establecimiento">
                {proposal.displayName}
                {proposal.note ? (
                  <span className="block text-sm text-muted" data-testid={`proposal-note-${proposal.id}`}>
                    {proposal.note}
                  </span>
                ) : null}
              </SimpleTableCell>
              <SimpleTableCell data-label="Tipo" data-testid={`proposal-kind-${proposal.id}`}>
                {KIND_LABELS[proposal.kind] ?? proposal.kind}
              </SimpleTableCell>
              <SimpleTableCell data-label="Partner">{proposal.partner?.display_name ?? "—"}</SimpleTableCell>
              <SimpleTableCell data-label="Enviada">
                {formatDateInBogota(proposal.created_at, "es")}
              </SimpleTableCell>
              <SimpleTableCell>
                <Link
                  href={
                    proposal.entityType === "establishment"
                      ? `/admin/proposals/${proposal.id}?entity=establishment`
                      : `/admin/proposals/${proposal.id}`
                  }
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  data-testid={`review-link-${proposal.id}`}
                >
                  Revisar
                </Link>
              </SimpleTableCell>
            </SimpleTableRow>
          ))
        ) : (
          <SimpleTableRow>
            <SimpleTableCell colSpan={5} className="text-center text-muted">
              Ninguna propuesta pendiente.
            </SimpleTableCell>
          </SimpleTableRow>
        )}
      </SimpleTableBody>
    </SimpleTable>
  );
}
