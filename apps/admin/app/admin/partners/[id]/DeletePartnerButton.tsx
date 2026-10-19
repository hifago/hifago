"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, toast } from "@hifago/ui";

// Même confirmation destructive que DeleteProductButton. N'est rendu par la fiche que si
// admin_partner_deletion_check l'autorise (aucune commande, pas le partenaire plateforme) ; la
// route revérifie quand même : une commande a pu arriver entre l'affichage et le clic.
export function DeletePartnerButton({ partnerId }: { partnerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleDelete() {
    setIsSubmitting(true);

    const response = await fetch(`/api/partners/${partnerId}`, { method: "DELETE" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as
      | { ok: true; accountsNotDeleted: string[] }
      | { ok: false; reason: string }
      | null;

    if (!body?.ok) {
      // Échec seulement : sur un succès, le bouton reste inactif jusqu'à la navigation.
      setIsSubmitting(false);
      toast.danger(
        body?.reason === "has_orders"
          ? "Este partner ya tiene reservas: usa el offboarding en su lugar."
          : "No se pudo eliminar el partner.",
      );
      return;
    }

    if (body.accountsNotDeleted.length > 0) {
      toast.danger(
        `Partner eliminado, pero ${body.accountsNotDeleted.length} cuenta(s) de acceso no se pudieron borrar: su correo sigue ocupado.`,
      );
    } else {
      toast.success("Partner eliminado. Su correo y su código quedan libres.");
    }
    router.push("/admin/partners");
    router.refresh();
  }

  return (
    <>
      <Button
        type="button"
        variant="danger"
        size="sm"
        onPress={() => setOpen(true)}
        data-testid="delete-partner-button"
      >
        Eliminar definitivamente
      </Button>
      <Modal>
        <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Eliminar partner definitivamente</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-2">
                <p className="text-sm text-muted">
                  Se borran el partner, sus establecimientos, actividades, fotos, códigos e
                  invitaciones, y las cuentas de acceso de su equipo. Su correo y su código quedan
                  libres para una nueva invitación.
                </p>
                <p className="text-sm font-medium text-danger">Esta acción no se puede deshacer.</p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="danger"
                  isDisabled={isSubmitting}
                  onPress={handleDelete}
                  data-testid="confirm-delete-partner-button"
                >
                  {isSubmitting ? "Eliminando…" : "Eliminar"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
