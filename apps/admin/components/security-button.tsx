"use client";

import { useState } from "react";
import { Button } from "@hifago/ui";
import { SecurityDialog } from "./security-dialog";

// Entrée « Seguridad » du pied de la barre de navigation (admin) : ouvre la modale de gestion du 2FA.
// Même gabarit que LogoutButton, pour que les deux boutons du pied s'alignent.
export function SecurityButton({
  className,
  "data-testid": dataTestId = "security-button",
}: {
  className?: string;
  "data-testid"?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onPress={() => setOpen(true)}
        data-testid={dataTestId}
        className={className}
      >
        Seguridad
      </Button>
      <SecurityDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
