"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/atoms/Button";
import { signOutAndGoHome } from "./signOutAndGoHome";

// Spec 35 décision ⑨ — vit UNIQUEMENT sur /cuenta/perfil (choix explicite de Jérôme, pas dans le
// layout partagé ni dans SiteMenu). Adapté d'`apps/admin/components/LogoutButton.tsx`, jamais
// partagé tel quel : celui-ci passe par `@/i18n/navigation` (préfixe de locale) et par l'atome
// `Button` de la vitrine, ni l'un ni l'autre n'existant côté admin.
export function LogoutButton() {
  const t = useTranslations("AccountProfilePage");
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    setIsSubmitting(true);
    await signOutAndGoHome(router);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      color="neutral"
      onPress={handleLogout}
      isPending={isSubmitting}
      pendingLabel={t("loggingOut")}
      testId="logout-button"
    >
      {t("logoutButton")}
    </Button>
  );
}
