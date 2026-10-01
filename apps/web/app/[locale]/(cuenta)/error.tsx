"use client";

import { ErrorScreen } from "@/components/organisms/ErrorScreen";

// LA FRONTIÈRE D'ERREUR DE LA ZONE COMPTE (`/cuenta/*`). Un profil illisible n'est jamais un profil
// vide : `getMyProfile` lève, et c'est ici que le client l'apprend — au lieu d'un formulaire vide
// dont l'enregistrement écraserait son vrai profil. Écran partagé :
// `components/organisms/ErrorScreen.tsx`.
export default function ErrorCuenta({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorScreen error={error} retry={retry} zone="cuenta" testId="error-cuenta" />;
}
