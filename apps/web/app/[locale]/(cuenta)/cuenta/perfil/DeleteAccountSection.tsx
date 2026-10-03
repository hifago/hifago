"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/atoms/Button";
import { TextField, Input, Label } from "@hifago/ui";
import { signOutAndGoHome } from "./signOutAndGoHome";
import { Aviso } from "@/components/molecules/Aviso";

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
    let reponse: Response;
    try {
      reponse = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: confirmEmail }),
      });
    } catch {
      // Panne réseau : `fetch` REJETTE au lieu de répondre. Sans ce garde, le bouton restait figé
      // « en cours » et « No » désactivé, sans un mot. Même écran que l'échec renvoyé par le
      // serveur : la main est rendue, réessayer est possible.
      setIsSubmitting(false);
      setErreur("failed");
      return;
    }

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

  // Plan 41, P9 : le titre fait partie de l'`Aviso`, comme le demande la zone de suppression. Un
  // compte professionnel reçoit un message d'information : aucune action n'a échoué et le bouton
  // de suppression ne doit jamais lui être proposé.
  if (hasProfessionalCapability) {
    return (
      <section data-testid="delete-account-section">
        <Aviso tono="info" titulo={t("deleteSectionTitle")}>
          <p data-testid="delete-blocked-capability">{t("deleteBlockedByCapability")}</p>
        </Aviso>
      </section>
    );
  }

  // Le formulaire qui remplace le bouton. Plus de bordure ni de teinte à lui : il est déjà dans
  // l'encadré rouge (plan 41, F6 : fin des bordures imbriquées). `w-full` : la rangée d'actions de
  // l'`Aviso` est un flex qui passe à la ligne, le formulaire en prend toute la largeur. Une
  // variable JSX, jamais un composant déclaré ici : recréé à chaque rendu, il remonterait le champ
  // (et perdrait le focus) à chaque frappe.
  const action = !isConfirming ? (
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
      className="flex w-full flex-col gap-2"
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
  );

  return (
    <section data-testid="delete-account-section">
      <Aviso tono="error" titulo={t("deleteSectionTitle")} accion={action}>
        <p>{t("deleteSectionDescription")}</p>
      </Aviso>
    </section>
  );
}
