"use client";

import { ErrorScreen } from "@/components/organisms/ErrorScreen";

// LA FRONTIÈRE D'ERREUR DE LA ZONE TUNNEL (`/mi-viaje`, `/pago`). Un panier illisible n'est jamais
// un panier vide : `getCartLines` lève, et c'est ici que le client l'apprend — au lieu de « Tu viaje
// está vacío », qui lui ferait croire ses réservations perdues. Écran partagé :
// `components/organisms/ErrorScreen.tsx`.
export default function ErrorTunel({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorScreen error={error} retry={retry} zone="tunnel" testId="error-tunnel" />;
}
