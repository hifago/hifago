"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Modal, toast } from "@hifago/ui";

// Mirroir de apps/admin/app/admin/invitations/RevokeInvitationButton.tsx — pattern déjà utilisé
// dans le projet pour une confirmation destructive. Branché sur rpcError.code (pas le texte du
// message) : delete_product distingue "produit introuvable" (P0001) de "déjà commandée" (23503,
// cf. supabase/migrations/20260815220000_delete_product_rpc.sql). Reste exclusivement sur la
// fiche détail (décision Jérôme, docs/specs/10-...md) — jamais remonté comme action de ligne sur
// /admin/products, un seul exemplaire par page.
export function DeleteProductButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [alreadyOrdered, setAlreadyOrdered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleDelete() {
    setAlreadyOrdered(false);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("delete_product", {
      p_product_id: productId,
    });

    if (rpcError) {
      // Échec seulement : sur un succès, le bouton reste inactif jusqu'à la navigation, qui
      // démonte ce composant — le réactiver avant permettait un second envoi pendant le
      // rechargement (2026-10-01).
      setIsSubmitting(false);
      if (rpcError.code === "23503") {
        setAlreadyOrdered(true);
        toast.danger("No se pudo eliminar la actividad: ya fue reservada.");
      } else {
        toast.danger("No se pudo eliminar la actividad.");
      }
      return;
    }

    toast.success("Actividad eliminada.");
    router.push("/admin/products");
    router.refresh();
  }

  return (
    <>
      <Button
        type="button"
        variant="danger"
        size="sm"
        onPress={() => setOpen(true)}
        data-testid="delete-product-button"
      >
        Eliminar
      </Button>
      <Modal>
        <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Eliminar actividad</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                {alreadyOrdered ? (
                  <p role="alert" data-testid="delete-product-already-ordered" className="text-sm text-danger">
                    Esta actividad ya fue reservada y no se puede eliminar.{" "}
                    <Link href={`/admin/products/${productId}/edit`} className="underline">
                      Despublícala en su lugar
                    </Link>
                    .
                  </p>
                ) : (
                  <p className="text-sm text-muted">Esta acción no se puede deshacer.</p>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="danger"
                  isDisabled={isSubmitting || alreadyOrdered}
                  onPress={handleDelete}
                  data-testid="confirm-delete-product-button"
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
