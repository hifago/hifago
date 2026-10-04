"use client";

import { ErrorScreen } from "@/components/organisms/ErrorScreen";

// LA FRONTIÈRE D'ERREUR DE LA ZONE VITRINE (spec 27 § « Cas limites », spec 28 §9 — 2026-09-08).
// Une lecture de `lib/` qui lève (catalogue, fiche, commande) arrive ici, rendue À L'INTÉRIEUR de
// la coquille de la zone. Tout ce que l'écran fait — et ne fait jamais, comme afficher le message
// brut — est dans `components/organisms/ErrorScreen.tsx`, partagé par les trois zones.
export default function ErrorVitrine({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorScreen error={error} retry={retry} zone="vitrine" testId="error-vitrine" />;
}
