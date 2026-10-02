"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/atoms/Button";
import { TextField, Input, Label } from "@hifago/ui";
import { signOutAndGoHome } from "./signOutAndGoHome";
import { Title } from "@/components/atoms/Title";

// Spec 35 décisions ④/⑪ — confirmation forte et définitive, bloquée en amont pour un compte
// professionnel. Même patron de confirmation-remplace-le-bouton que `CancelLineButton.tsx`
// (spec 34) : pas de `Modal` HeroUI monté dans `apps/web`, le bloc prend la place exacte du
// bouton, reçoit le focus, s'annonce par `role="alert"`.
//
// ⚠️ LA VÉRIFICATION CÔTÉ CLIENT NE PROTÈGE RIEN — elle n'existe que pour désactiver le bouton
// « Sí, eliminar » avant l'envoi (confort). La VRAIE vérification est côté serveur
// (`app/api/account/delete/route.ts`), sur l'email connu de LA SESSION, jamais sur une valeur
// transmise par le client. Un email qui ne correspond pas renvoie 400 sans rien toucher.
//
// ⚠️ `hasProfessionalCapability` désactive tout AVANT le premier clic : la garde vit aussi dans
// `delete_my_account()` (spec 35 §7.1), mais l'exposer seulement après un refus ferait découvrir la
// règle à un référent au pire moment. Les deux lectures utilisent la MÊME portée
// (`getMyProfile.ts`) — jamais recalculées différemment.

export function DeleteAccountSection({
  email,
  hasProfessionalCapability,
}: {
  email: string;
  hasProfessionalCapability: boolean;
}) {
  const t = useTranslations("AccountProfilePage");
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [erreur, setErreur] = useState<"mismatch" | "failed" | null>(null);
  const confirmRef = useRef<HTMLFormElement>(null);

  // Même geste que `CancelLineButton.tsx` : le focus suit le bloc de confirmation qui remplace
  // le bouton, sinon un utilisateur au clavier reste sur un élément qui n'existe plus.
  useEffect(() => {
    if (!isConfirming) return;
    confirmRef.current?.querySelector("input")?.focus();
  }, [isConfirming]);

  async function handleConfirm(event: React.FormEvent) {
    event.preventDefault();
    setErreur(null);

    if (confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      setErreur("mismatch");
      return;
    }

    setIsSubmitting(true);
    const reponse = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: confirmEmail }),
    });

    if (!reponse.ok) {
      setIsSubmitting(false);
      setErreur("failed");
      return;
    }

    // La suppression a réussi côté serveur (partner_accounts anonymisé, auth.users neutralisé) :
    // la session locale n'a plus rien à faire ici, mais son jeton reste techniquement valide
    // jusqu'à expiration — signOut() la révoque explicitement plutôt que d'attendre.
    await signOutAndGoHome(router);
  }

  if (hasProfessionalCapability) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-default-200 p-4" data-testid="delete-account-section">
        <Title as="h2" size="bloque">
          {t("deleteSectionTitle")}
        </Title>
        <p className="text-sm text-muted" data-testid="delete-blocked-capability">
          {t("deleteBlockedByCapability")}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-default-200 p-4" data-testid="delete-account-section">
      <Title as="h2" size="bloque">
        {t("deleteSectionTitle")}
      </Title>
      <p className="text-sm text-muted">{t("deleteSectionDescription")}</p>

      {!isConfirming ? (
        <Button
          type="button"
          variant="outline"
          color="danger"
          size="sm"
          width="auto"
          onPress={() => setIsConfirming(true)}
          testId="delete-account-button"
        >
          {t("deleteButton")}
        </Button>
      ) : (
        <form
          ref={confirmRef}
          onSubmit={handleConfirm}
          noValidate
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-danger bg-danger/10 p-3"
          data-testid="delete-account-confirm"
        >
          <TextField name="confirm-email" value={confirmEmail} onChange={setConfirmEmail} isRequired>
            <Label>{t("deleteConfirmLabel", { email })}</Label>
            <Input type="email" autoComplete="off" data-testid="delete-account-email-input" />
          </TextField>
          {erreur === "mismatch" ? (
            <p role="alert" className="text-sm text-danger" data-testid="delete-account-mismatch">
              {t("deleteConfirmMismatch")}
            </p>
          ) : null}
          {erreur === "failed" ? (
            <p role="alert" className="text-sm text-danger" data-testid="delete-account-error">
              {t("deleteError")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              color="danger"
              size="sm"
              isPending={isSubmitting}
              pendingLabel={t("deleting")}
              testId="delete-account-confirm-yes"
            >
              {t("deleteConfirmYes")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              color="neutral"
              size="sm"
              isDisabled={isSubmitting}
              onPress={() => {
                setIsConfirming(false);
                setConfirmEmail("");
                setErreur(null);
              }}
              testId="delete-account-confirm-no"
            >
              {t("deleteConfirmNo")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
