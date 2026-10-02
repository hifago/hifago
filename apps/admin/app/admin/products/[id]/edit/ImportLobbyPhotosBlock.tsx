"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, toast } from "@hifago/ui";

// Arbitrage Jérôme du 2026-08-26 (« import à la liaison ») — dernier maillon manquant : la carte de
// prévisualisation du sélecteur MONTRE les photos que Lobby détient, mais rien ne les faisait entrer
// dans catalog-media. Une chambre PMS-backed restait donc sans image dans le catalogue public.
// Admin-only, comme les autres gestes sur le lien (le socio garde son parcours de proposition).

const REASON_LABELS: Record<string, string> = {
  gallery_full: "La galería ya tiene 6 fotos.",
  no_photos_in_lobby: "LobbyPMS no tiene fotos para esta categoría.",
  pms_not_connected: "Este establecimiento no está conectado a LobbyPMS.",
  not_pms_backed: "Esta habitación no está vinculada a una categoría de LobbyPMS.",
  lobby_rejected: "LobbyPMS rechazó la consulta.",
  lobby_unreachable: "No se pudo contactar con LobbyPMS.",
  not_authorized: "Solo un administrador puede importar fotos.",
  // Réponses 503 de la route (échec fermé, 2026-10-01) : « je n'ai pas pu le savoir », pas un
  // refus — même texte que lobby-option-picker pour l'autorisation, pour que l'admin retente.
  authorization_unavailable: "No se pudo verificar tu acceso en este momento. Vuelve a intentarlo.",
  catalog_unavailable: "No se pudo leer la actividad en este momento. Vuelve a intentarlo.",
};

export function ImportLobbyPhotosBlock({ productId }: { productId: string }) {
  const [isImporting, setIsImporting] = useState(false);
  const router = useRouter();

  async function handleImport() {
    setIsImporting(true);
    try {
      const response = await fetch("/api/pms/import-room-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        imported?: number;
        skipped?: { url: string; reason: string }[];
        reason?: string;
      };

      if (!result.ok) {
        toast.danger(REASON_LABELS[result.reason ?? ""] ?? "No se pudieron importar las fotos.");
        return;
      }
      if ((result.imported ?? 0) === 0) {
        // Un import qui n'importe rien n'est pas un succès muet : dire pourquoi, sinon l'écran
        // laisse croire à un bug.
        toast.info(REASON_LABELS[result.reason ?? ""] ?? "No había fotos nuevas que importar.");
        return;
      }

      const skippedCount = result.skipped?.length ?? 0;
      toast.success(
        skippedCount > 0
          ? `${result.imported} foto(s) importada(s), ${skippedCount} descartada(s).`
          : `${result.imported} foto(s) importada(s) desde LobbyPMS.`
      );
      router.refresh();
    } catch {
      toast.danger("No se pudieron importar las fotos.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        isDisabled={isImporting}
        onPress={handleImport}
        data-testid="import-lobby-photos-button"
      >
        {isImporting ? "Importando…" : "Importar fotos de LobbyPMS"}
      </Button>
      <p className="text-xs text-muted">
        Copia las fotos de la categoría vinculada. Puedes borrarlas o reordenarlas después como
        cualquier otra foto.
      </p>
    </div>
  );
}
