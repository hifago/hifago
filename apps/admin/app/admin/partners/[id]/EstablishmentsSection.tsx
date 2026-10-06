"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import {
  Button,
  Modal,
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
  toast,
} from "@hifago/ui";
import { SearchableCombobox } from "@/components/searchable-combobox";

type OwnEstablishment = { id: string; name: string; status: string };
type AnyEstablishment = { id: string; name: string; ownerName: string };

// Ce que la confirmation annonce avant le transfert. "error" s'affiche comme tel, jamais comme
// « aucune proposition » : une panne de lecture n'est pas une absence.
type TransferCheck =
  | { status: "loading" }
  | { status: "error" }
  | { status: "resync" }
  | { status: "ready"; pendingProductProposals: number; pendingEstablishmentProposals: number };

export function EstablishmentsSection({
  partnerId,
  ownEstablishments,
  allEstablishments,
}: {
  partnerId: string;
  ownEstablishments: OwnEstablishment[];
  allEstablishments: AnyEstablishment[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<TransferCheck>({ status: "loading" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Seule la dernière lecture compte : une confirmation rouverte sur un autre établissement pendant
  // le comptage ne doit pas afficher les chiffres du précédent.
  const lastCheckRequest = useRef(0);

  const selected = allEstablishments.find((establishment) => establishment.id === selectedId) ?? null;

  // Propositions en attente du propriétaire ACTUEL sur cet établissement — même périmètre que le
  // comptage de transfer_establishment (20261006182227), qui reste l'autorité : il recompte sous
  // verrou et journalise son propre résultat. Une proposition de contenu ou de photos n'a que
  // product_id, une proposition de création que establishment_id, d'où les deux lectures.
  async function loadTransferCheck(establishmentId: string): Promise<TransferCheck> {
    const supabase = createClient();
    const { data: establishment, error: establishmentError } = await supabase
      .from("establishments")
      .select("partner_id")
      .eq("id", establishmentId)
      .single();
    if (establishmentError) return { status: "error" };
    if (establishment.partner_id === partnerId) return { status: "resync" };

    const ownerId = establishment.partner_id;
    const [byEstablishment, byProduct, establishmentProposals] = await Promise.all([
      supabase
        .from("product_proposals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("partner_id", ownerId)
        .eq("establishment_id", establishmentId),
      supabase
        .from("product_proposals")
        .select("id, product:products!inner(establishment_id)", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("partner_id", ownerId)
        .is("establishment_id", null)
        .eq("product.establishment_id", establishmentId),
      supabase
        .from("establishment_proposals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("partner_id", ownerId)
        .eq("establishment_id", establishmentId),
    ]);
    if (byEstablishment.error || byProduct.error || establishmentProposals.error) {
      return { status: "error" };
    }
    return {
      status: "ready",
      pendingProductProposals: (byEstablishment.count ?? 0) + (byProduct.count ?? 0),
      pendingEstablishmentProposals: establishmentProposals.count ?? 0,
    };
  }

  // Le bouton du formulaire n'ouvre que la confirmation (cahier admin §3d) : le transfert retire
  // la capacité operator de l'ancien propriétaire sur cet établissement et lui reprend ses
  // produits, il ne part jamais en un clic.
  async function handleOpenConfirmation(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const request = ++lastCheckRequest.current;
    setCheck({ status: "loading" });
    setOpen(true);
    const result = await loadTransferCheck(selectedId);
    if (request === lastCheckRequest.current) setCheck(result);
  }

  async function handleTransfer() {
    if (!selectedId) return;
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("transfer_establishment", {
      p_establishment_id: selectedId,
      p_new_partner_id: partnerId,
    });

    setIsSubmitting(false);
    if (rpcError) {
      toast.danger("No se pudo transferir el establecimiento.");
      return;
    }
    toast.success("Establecimiento transferido.");
    setOpen(false);
    setSelectedId(null);
    router.refresh();
  }

  const pendingTotal =
    check.status === "ready" ? check.pendingProductProposals + check.pendingEstablishmentProposals : 0;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Establecimientos</h2>

      <SimpleTable data-testid="own-establishments-table" aria-label="Establecimientos propios">
        <SimpleTableHeader>
          <SimpleTableRow>
            <SimpleTableHead>Nombre</SimpleTableHead>
            <SimpleTableHead>Estado</SimpleTableHead>
          </SimpleTableRow>
        </SimpleTableHeader>
        <SimpleTableBody>
          {ownEstablishments.length > 0 ? (
            ownEstablishments.map((establishment) => (
              <SimpleTableRow
                key={establishment.id}
                id={establishment.id}
                data-testid={`own-establishment-row-${establishment.id}`}
              >
                <SimpleTableCell data-label="Nombre">{establishment.name}</SimpleTableCell>
                <SimpleTableCell data-label="Estado">{establishment.status}</SimpleTableCell>
              </SimpleTableRow>
            ))
          ) : (
            <SimpleTableRow>
              <SimpleTableCell colSpan={2} className="text-center text-muted">
                Ningún establecimiento todavía.
              </SimpleTableCell>
            </SimpleTableRow>
          )}
        </SimpleTableBody>
      </SimpleTable>

      {/* Sélecteur sur TOUT le registre (pas seulement les établissements "libres" — aucun ne
          l'est jamais, establishments.partner_id est not null) : transfer_establishment n'a qu'un
          seul chemin, premier rattachement et transfert confondus. */}
      <form onSubmit={handleOpenConfirmation} noValidate className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <SearchableCombobox
            items={allEstablishments}
            getKey={(establishment) => establishment.id}
            getLabel={(establishment) => establishment.name}
            value={selectedId}
            onChange={setSelectedId}
            label="Transferir un establecimiento a este partner"
            placeholder="Buscar establecimiento…"
            testId="transfer-establishment-search"
            renderItem={(establishment) => `${establishment.name} — actualmente: ${establishment.ownerName}`}
          />
        </div>
        <Button type="submit" isDisabled={!selectedId} data-testid="transfer-establishment-button">
          Transferir
        </Button>
      </form>

      <Modal>
        <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
          <Modal.Container>
            <Modal.Dialog data-testid="transfer-establishment-confirmation">
              <Modal.Header>
                <Modal.Heading>Transferir establecimiento</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-3 text-sm">
                {check.status === "resync" ? (
                  <p className="text-muted">
                    {selected?.name} ya pertenece a este partner: se resincronizarán su capacidad
                    operator y sus productos.
                  </p>
                ) : (
                  <p className="text-muted">
                    {selected?.name} pasará de {selected?.ownerName} a este partner.{" "}
                    {selected?.ownerName} pierde la capacidad operator sobre este establecimiento y
                    sus productos pasan a este partner.
                  </p>
                )}
                {check.status === "loading" ? (
                  <p className="text-muted">Comprobando propuestas pendientes…</p>
                ) : null}
                {check.status === "error" ? (
                  <p className="text-danger" data-testid="transfer-pending-proposals-error">
                    No se pudieron contar las propuestas pendientes de {selected?.ownerName}.
                  </p>
                ) : null}
                {check.status === "ready" && pendingTotal > 0 ? (
                  <p data-testid="transfer-pending-proposals">
                    {selected?.ownerName} tiene propuestas pendientes sobre este establecimiento (
                    {check.pendingProductProposals} de producto, {check.pendingEstablishmentProposals}{" "}
                    de establecimiento): se conservan tal cual, ni rechazadas ni transferidas.
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  isDisabled={isSubmitting || check.status === "loading"}
                  onPress={handleTransfer}
                  data-testid="confirm-transfer-establishment-button"
                >
                  {isSubmitting ? "Transfiriendo…" : "Transferir"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </section>
  );
}
