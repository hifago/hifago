"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@hifago/supabase/client";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/atoms/Button";
import { Aviso } from "@/components/molecules/Aviso";
import { useCancellationIssue } from "./CancellationOutcomes";

// Spec 34 décisions ⑤ et ⑧ — annuler UNE prestation, après une confirmation qui dit ce qu'elle coûte.
//
// ⚠️ POURQUOI UNE CONFIRMATION INLINE ET PAS UNE MODALE. Aucun `Modal` HeroUI n'est monté dans
// `apps/web` à ce jour ; en introduire un pour ce bouton ferait entrer un composant de coquille par
// la petite porte, sans que personne n'ait tranché son apparence. Le bloc remplace le bouton à sa
// place exacte : il est annoncé (`role="alert"`), il reçoit le focus, et il ne déplace rien d'autre.
//
// ⚠️ LA CONFIRMATION NE CHIFFRE AUCUN MONTANT (décision ⑧) : la chaîne `cancelConfirmNoRefund` ne
// porte pas de variable de prix, ce qui rend la règle impossible à contourner par distraction. Le
// cahier §2d voulait cette mention « sur l'écran de paiement, et pas ailleurs » — la spec 34 le
// révise, parce que c'est ici que le client perd de l'argent sans pouvoir défaire. Elle n'est dite
// QUE si l'acompte a été encaissé (`depositRetained`) : sur une commande impayée, elle serait fausse.
//
// ⚠️ CE COMPOSANT EST RENDU POUR CHAQUE LIGNE, annulable ou non (`cancellable`, décidé en base), et
// l'issue d'une annulation vit dans `CancellationOutcomes` (monté par la page), pas ici : après
// `router.refresh()`, la ligne n'est plus annulable et sa carte peut même changer de section (voir
// CancellationOutcomes.tsx) — le message « Anulaste… » survit aux deux.
//
// ⚠️ L'`error` de supabase-js est LUE, contrairement à `OrdersList.tsx` qu'on remplace : une panne
// réseau et un refus métier ne disent pas la même chose, et les confondre a produit un écran qui
// répondait « impossible d'annuler » à un problème de connexion.

type CancelOrderLineResult = { ok: boolean; reason?: string; remaining_active_lines?: number };

// Refus de `cancel_order_line` (20261006192424) → texte. Une panne ou un motif inconnu : `cancelError`.
const ERREUR_PAR_MOTIF: Record<string, string> = {
  line_not_active: "cancelErrorNotActive",
  line_not_found: "cancelErrorNotFound",
  not_authenticated: "cancelErrorSession",
  anonymous_session: "cancelErrorSession",
};

export type CancelLineButtonProps = {
  lineId: string;
  /** Le nom du produit, DÉJÀ résolu dans la locale — un composant ne retraduit pas ce qu'il reçoit. */
  productName: string;
  /** La date (ou la plage, ou le créneau), déjà formatée par `formatLineSchedule`. */
  dateLabel: string;
  /**
   * Vrai quand c'est la DERNIÈRE prestation encore active de la commande : la confirmation prévient
   * alors qu'il n'en restera aucune en attente. Jamais « toute la réservation est annulée » : une
   * prestation déjà réalisée peut coexister, et la commande n'est alors pas annulée.
   */
  isLastActiveLine: boolean;
  /** Décidé en base (`list_my_orders`). Faux : rien à proposer, sauf l'issue d'une annulation. */
  cancellable: boolean;
  /** Dire « l'acompte n'est pas rendu » : acquis selon la base (`depositKeptOnCancel`) et non nul. */
  depositRetained: boolean;
  testId?: string;
};

export function CancelLineButton({
  lineId,
  productName,
  dateLabel,
  isLastActiveLine,
  cancellable,
  depositRetained,
  testId,
}: CancelLineButtonProps) {
  const t = useTranslations("AccountOrdersPage");
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [issue, setIssue] = useCancellationIssue(lineId);
  const confirmRef = useRef<HTMLDivElement>(null);

  // Le bloc de confirmation prend la place du bouton : sans ce déplacement de focus, un utilisateur
  // au clavier resterait sur un bouton qui n'existe plus, et un lecteur d'écran annoncerait le
  // texte sans jamais atteindre les deux réponses.
  useEffect(() => {
    if (!isConfirming) return;
    confirmRef.current?.querySelector("button")?.focus();
  }, [isConfirming]);

  async function handleConfirm() {
    setIsPending(true);
    setIssue(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("cancel_order_line", { p_line_id: lineId });
    const result = data as CancelOrderLineResult | null;

    if (error || !result?.ok) {
      setIsPending(false);
      const motif = error ? undefined : result?.reason;
      const cle = (motif && ERREUR_PAR_MOTIF[motif]) || "cancelError";
      setIssue({ kind: "failed", message: t(cle) });
      // Statut changé entre-temps (déjà annulée, réalisée…) : réessayer ne sert à rien. On ferme la
      // confirmation et l'écran relit la base, qui montre le vrai statut ; le message reste.
      if (motif === "line_not_active") {
        setIsConfirming(false);
        router.refresh();
      }
      return;
    }

    // ⚠️ `router.refresh()` et non une mise à jour optimiste : l'écran relit `list_my_orders`, donc
    // la base. `OrdersList.tsx` recopiait la transition à la main, ce qui obligeait le client à
    // faire confiance à deux sources — et aurait menti si la RPC avait refusé pour une autre raison.
    // Le composant reste `isPending` jusqu'au rendu suivant : la carte est alors reconstruite.
    // Décision de Gabriel (2026-10-06) : le client doit SAVOIR que l'annulation a eu lieu. Le
    // message reste après le rafraîchissement (voir l'en-tête).
    setIssue({ kind: "cancelled", wholeOrder: result.remaining_active_lines === 0 });
    router.refresh();
    setIsConfirming(false);
    setIsPending(false);
  }

  // Plan 41, P8 : l'échec est rendu SOUS la confirmation comme sous le bouton. Avant, il ne
  // s'affichait qu'après « No » (défaut connu n° 4) : la confirmation revenait à l'identique et
  // le client ne savait pas que rien n'avait été annulé. Correctif d'AFFICHAGE seulement : l'appel
  // et ses états sont ceux d'avant.
  const erreur =
    issue?.kind === "failed" ? (
      <Aviso tono="error" rol="alert" compacto testId={testId ? `${testId}-error` : undefined}>
        {issue.message}
      </Aviso>
    ) : null;

  if (issue?.kind === "cancelled") {
    return (
      <Aviso tono="exito" rol="status" compacto testId={testId ? `${testId}-done` : undefined}>
        <p>{t("cancelDone", { product: productName, date: dateLabel })}</p>
        {issue.wholeOrder ? <p className="font-semibold">{t("cancelDoneWholeOrder")}</p> : null}
      </Aviso>
    );
  }

  if (!cancellable) return erreur;

  if (!isConfirming) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Button variant="ghost" color="danger" onPress={() => setIsConfirming(true)} testId={testId}>
          {t("cancelLine")}
        </Button>
        {erreur}
      </div>
    );
  }

  // L'encadré d'alerte de la charte (S6), compact parce qu'il vit dans la ligne. Le `role` reste
  // `alert` et le `data-testid` `-confirm` : c'est l'élément que les tests et l'e2e lisent.
  return (
    <div ref={confirmRef} className="flex flex-col gap-2">
      <Aviso
        tono="alerta"
        rol="alert"
        compacto
        titulo={t("cancelConfirmTitle", { product: productName, date: dateLabel })}
        testId={testId ? `${testId}-confirm` : undefined}
        accion={
          <>
            <Button
              color="danger"
              size="sm"
              onPress={handleConfirm}
              isPending={isPending}
              pendingLabel={t("cancelling")}
              testId={testId ? `${testId}-yes` : undefined}
            >
              {t("cancelConfirmYes")}
            </Button>
            <Button
              variant="ghost"
              color="neutral"
              size="sm"
              onPress={() => setIsConfirming(false)}
              isDisabled={isPending}
              testId={testId ? `${testId}-no` : undefined}
            >
              {t("cancelConfirmNo")}
            </Button>
          </>
        }
      >
        {depositRetained ? (
          <p data-testid={testId ? `${testId}-no-refund` : undefined}>{t("cancelConfirmNoRefund")}</p>
        ) : null}
        {isLastActiveLine ? (
          <p className="font-semibold" data-testid={testId ? `${testId}-last-line` : undefined}>
            {t("cancelConfirmLastLine")}
          </p>
        ) : null}
      </Aviso>
      {erreur}
    </div>
  );
}
