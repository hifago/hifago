"use client";

import { useRouter } from "next/navigation";
import { TotpEnrollment } from "@/components/totp-enrollment";

// Écran d'enrôlement atteint volontairement (modale « Seguridad » = chemin principal ; cette page
// reste pour un lien direct). Le 2FA n'est jamais forcé : « Más tarde » renvoie simplement à `next`.
export function MfaEnrollForm({ next }: { next: string }) {
  const router = useRouter();

  function leave() {
    router.push(next);
    router.refresh();
  }

  return <TotpEnrollment onEnrolled={leave} onCancel={leave} cancelLabel="Más tarde" />;
}
