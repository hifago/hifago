"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { isValidPhoneNumber } from "react-phone-number-input";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { useCart } from "@/lib/cart/CartContext";
import { Button, Checkbox, Input, Label, TextField } from "@hifago/ui";
import { PhoneField } from "@/components/atoms/PhoneField";

// Raisons qui renvoient `line` (product_id/date de LA ligne fautive) — toujours un sous-ensemble
// de KNOWN_REASONS ci-dessous (composé à partir de celui-ci, jamais recopié à la main : chaque
// littéral n'existe qu'à un seul endroit du fichier). Spec 17 §0 Tranche 2 (alojamiento par
// plage) : invalid_date_range/unsupported_date_range, jamais censées surgir via l'écran réel, mais
// mappées en défense en profondeur si la RPC est appelée directement avec un panier malformé.
// Spec 18 §0 Tranche 1 (produit à créneaux horaires) : slot_required/unsupported_slot_combination,
// même traitement — défense en profondeur, l'écran réel (SlotReservationForm) empêche déjà
// l'absence de slot_start_time ou une combinaison incohérente.
//
// room_type_required/room_type_mismatch/room_type_not_found/end_date_required ont disparu avec
// l'étage hôtel (T3 étape 2, 20260827220000) : create_order ne les produit plus. Les garder ici
// aurait promis une traduction pour une réponse impossible.
// camp_missing_lodging (2026-09-15) : un camp sans hébergement compatible dans le panier —
// l'écran réel (ReservationForm.tsx) guide déjà vers /alojamientos après l'ajout d'un camp, mais
// cette raison reste atteignable si le client revient au checkout sans avoir ajouté d'hébergement,
// ou via un appel direct à la RPC.
// Migration 20260929112240 : qty_cap_exceeded vise une ligne (create_order renvoie `line`) et
// rejoint cette liste ; date_range_required (logement sans date de départ, défense en profondeur :
// LodgingReservationForm envoie toujours endDate) ; pms_unavailable (logement PMS dont le
// connecteur de l'établissement est coupé, CLAUDE.md §4.4).
const LINE_SCOPED_REASONS = [
  "product_not_found",
  "not_sellable",
  "date_closed",
  "slot_not_found",
  "full",
  "resource_unavailable",
  "camp_missing_lodging",
  "invalid_date_range",
  "unsupported_date_range",
  "slot_required",
  "unsupported_slot_combination",
  "qty_below_minimum",
  "qty_cap_exceeded",
  "date_range_required",
  "pms_unavailable",
] as const;

// Raisons de create_order qui ne visent PAS une ligne précise (visibles seulement au niveau de la
// commande entière) — jamais dans LINE_SCOPED_REASONS ci-dessus, sans quoi une raison order-scopée
// pointerait à tort sur une ligne du panier. not_authenticated n'apparaît nulle part ici : le
// correctif réservation invité a retiré ce garde-fou de create_order, la RPC ne renvoie plus
// jamais cette raison. resource_unavailable (feature 20, ligne-scopée) reste dans
// LINE_SCOPED_REASONS ci-dessus, pas ici. Cahier des charges client §3e, révisé 2026-08-17 :
// email_required/email_invalid — le champ HTML `isRequired` bloque déjà la soumission vide côté
// front, ces deux raisons restent le filet côté serveur (RPC appelée directement, format invalide
// échappé au front).
const ORDER_SCOPED_REASONS = [
  "empty_cart",
  "lodging_cap_exceeded",
  "prestation_cap_exceeded",
  "email_required",
  "email_invalid",
] as const;

// Toutes les raisons mappées côté écran (union des deux listes ci-dessus, jamais un 3e jeu de
// littéraux recopiés) — une raison inattendue (jamais censée arriver, mais la RPC reste la seule
// autorité) retombe sur "unknown" plutôt que de faire échouer next-intl sur une clé manquante.
const KNOWN_REASONS = [...LINE_SCOPED_REASONS, ...ORDER_SCOPED_REASONS] as const;

// ⚠️ Elle était générique tant qu'elle avait DEUX jeux de raisons à traiter ; le second
// (`create_payment_intent`) a suivi `startPayment` dans `OrderResult.tsx`, qui réécrit les trois
// lignes sur place — un helper partagé entre le tunnel et la vitrine pour si peu ne vaut pas le
// couplage. Ce qui restait ici, c'était la généricité sans le second appelant.
function resolveKnownReason(raw: string | undefined): (typeof KNOWN_REASONS)[number] | "unknown" {
  return raw !== undefined && (KNOWN_REASONS as readonly string[]).includes(raw)
    ? (raw as (typeof KNOWN_REASONS)[number])
    : "unknown";
}

type CreateOrderResult = {
  ok: boolean;
  reason?: string;
  order_id?: string;
  line?: { product_id?: string; date?: string; qty?: number };
};

export function CheckoutForm({
  isAuthenticated,
  initialHolderName = "",
  initialHolderPhone = "",
  initialHolderEmail = "",
}: {
  isAuthenticated: boolean;
  // Feature 32 — pré-remplissage pour un client connecté (page.tsx, depuis auth.users.email et sa
  // commande la plus récente). Défaut "" : comportement invité inchangé. Les champs restent
  // éditables — un pré-remplissage, jamais un verrou.
  initialHolderName?: string;
  initialHolderPhone?: string;
  initialHolderEmail?: string;
}) {
  const t = useTranslations("CheckoutPage");
  const tCommon = useTranslations("Common");
  // ⚠️ `useRouter` d'`@/i18n/navigation`, jamais de `next/navigation` : la redirection vise
  // `/reserva/<jeton>` et doit rester dans la langue du visiteur (même piège que `SignupForm`).
  const router = useRouter();
  // Spec 32 (panier en base) : ce formulaire ne porte plus la liste du panier (CartSummary,
  // rendu en lecture seule par pago/page.tsx, juste au-dessus) — `refresh()` sert uniquement à
  // resynchroniser la pastille du header une fois la commande créée (cart_items déjà vidée côté
  // serveur par create_order à ce moment-là, cf. son contrat).
  const { refresh } = useCart();

  const [holderName, setHolderName] = useState(initialHolderName);
  const [holderPhone, setHolderPhone] = useState(initialHolderPhone);
  const [holderEmail, setHolderEmail] = useState(initialHolderEmail);
  const [marketingConsent, setMarketingConsent] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ⚠️ SPEC 33 — CE FORMULAIRE NE PORTE PLUS AUCUN ÉTAT DE PAIEMENT, et c'est tout le sujet du lot.
  //
  // Il portait `pendingOrderId`/`paymentError`/`isPaying` et la fonction `startPayment`. Le défaut
  // n'était pas leur existence mais leur SUPPORT : un `useState` ne survit pas à un rechargement,
  // or le client part chez Mercado Pago et REVIENT. Au retour, `pendingOrderId` était perdu, le
  // panier déjà vidé par `create_order` (spec 32), et `pago/page.tsx` ne rendait donc plus rien —
  // page blanche, sans numéro ni message.
  //
  // Désormais : dès que la commande existe et que Lobby a accepté, on quitte le tunnel pour
  // `/reserva/<jeton>`, une adresse RECHARGEABLE, et c'est elle qui pilote le paiement
  // (`OrderResult.tsx`). Ce formulaire redevient ce qu'il annonce : des coordonnées et un bouton.

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // `PhoneField` (2026-09-10) ne pose jamais l'attribut natif `required`/`type="tel"` bloquant —
    // par construction, comme `Field` (cf. son en-tête), pour ne jamais dépendre du `noValidate` du
    // <form> ci-dessous (qu'il n'a pas — dette connue, `.claude/rules/apps.md`). Contrairement aux
    // deux autres champs (bloqués par la validation native faute de `noValidate`), le téléphone
    // doit donc désormais être vérifié ici : requis, puis format E.164 réel via la même lib.
    if (!holderPhone.trim()) {
      setError(t("errors.phone_required"));
      return;
    }
    if (!isValidPhoneNumber(holderPhone)) {
      setError(t("errors.phone_invalid"));
      return;
    }

    setIsSubmitting(true);

    // Spec 32 (panier en base) : create_order lit désormais ses propres lignes (cart_items) et son
    // attribution (carts) pour auth.uid() côté serveur — plus de p_lines/p_attribution_code/
    // p_attribution_source, un client ne peut plus les falsifier. `pago/page.tsx` ne rend ce
    // formulaire que si le panier n'est pas vide (getCartLines) : empty_cart reste le filet côté
    // serveur si le panier s'est vidé entre le chargement de la page et la soumission.
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_order", {
      p_holder_name: holderName.trim(),
      p_holder_email: holderEmail.trim(),
      p_holder_phone: holderPhone.trim(),
      p_marketing_consent: marketingConsent,
    });

    setIsSubmitting(false);

    const result = data as CreateOrderResult | null;
    if (rpcError || !result?.ok) {
      const reason = resolveKnownReason(result?.reason);
      setError(t(`errors.${reason}`));
      return;
    }

    const orderId = result.order_id ?? "";

    // ⚠️ LOBBY D'ABORD — RÉORDONNÉ LE 2026-08-29, et ce n'est pas « un await de plus ».
    //
    // Séquence précédente : create_order (qui CONFIRME) → `void reserve-nights` → `void
    // startPayment`. Les deux `void` étaient délibérés et documentés (« un échec PMS ne défait
    // jamais une réservation déjà confirmée »), mais la prémisse était fausse : sur le compte réel,
    // deux catégories refusent `POST /bookings` en 422 TOUT EN affichant une disponibilité non
    // nulle (spec 24 §11.2, C1 réfuté — rien dans `available-rooms` ne distingue une catégorie
    // réservable). Le client payait donc son acompte, l'écran disait « réservé », et le partenaire
    // ne recevait rien — sans même une annulation à compenser, puisque rien n'avait été créé.
    //
    // Désormais : Lobby → confirmation visible → encaissement. C'est ce qu'exige la spec 21 §8
    // (« échec fermé uniquement AVANT confirmation »), que le code violait en silence. Le succès
    // n'est affiché QU'APRÈS l'accord de Lobby, et `startPayment` n'est jamais atteint sans lui.
    //
    // ⚠️ La redirection vers `/reserva/<jeton>` n'est atteinte qu'APRÈS cet appel, et c'est le geste
    // central : c'est elle qui annonce la commande au client. La remonter au-dessus rendrait tout
    // le reste décoratif.
    let pmsResponse: Response;
    try {
      pmsResponse = await fetch("/api/pms/reserve-nights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
    } catch {
      // Réseau coupé pendant l'appel : on ne sait pas si Lobby a réservé. Échec fermé — rien n'est
      // encaissé, et expire_stale_payment_orders reprendra la commande dans les 30 minutes (avec,
      // au passage, l'annulation d'un booking qui aurait malgré tout été créé).
      setError(t("errors.pms_unreachable"));
      return;
    }

    if (!pmsResponse.ok) {
      const pmsResult = (await pmsResponse.json().catch(() => null)) as
        | { reason?: string; released?: boolean }
        | null;
      // ⚠️ RÉGRESSION CONNUE depuis spec 32 (panier en base), signalée pas corrigée ici — hors
      // périmètre de cette tranche. Avant : le panier restait en mémoire React tout du long, donc
      // intact ici même après un refus PMS (« le client peut changer de dates sans tout
      // ressaisir »). Depuis que create_order vide cart_items DANS SA PROPRE transaction dès qu'il
      // réussit (spec 32 §0, atomique avec la création de la commande), le panier est déjà VIDE à
      // cet instant — release_order_after_pms_refusal défait la commande mais ne recrée aucune
      // ligne cart_items, ce n'est pas son rôle. Le client devra ressaisir sa sélection.
      setError(t(pmsResult?.released === false ? "errors.pms_refused_pending" : "errors.pms_refused"));
      return;
    }

    // create_order a déjà vidé cart_items côté serveur (contrat spec 32 §0) — refresh() ne fait
    // que resynchroniser la pastille du header avec cet état déjà réel, jamais une suppression.
    void refresh();

    // Spec 33 — le jeton est lu en RLS DIRECTE, jamais renvoyé par `create_order` : `orders_select`
    // autorise déjà le propriétaire à lire sa propre ligne, et depuis la spec 31 l'invité EST un
    // propriétaire (`account_id` NOT NULL, identité anonyme). Rouvrir une RPC critique (CLAUDE.md
    // §4) pour deux champs de retour n'aurait eu aucune contrepartie.
    const { data: orderRow } = await supabase
      .from("orders")
      .select("access_token")
      .eq("id", orderId)
      .maybeSingle();

    if (!orderRow?.access_token) {
      // Ne devrait jamais arriver (colonne NOT NULL). La commande EST prise et Lobby a accepté :
      // on ne défait rien, on le dit — le client la retrouvera par son email de confirmation.
      setError(t("errors.unknown"));
      return;
    }

    router.push(`/reserva/${orderRow.access_token}`);
  }

  // Le panier (liste + total) est affiché juste au-dessus par `CartSummary` en lecture seule
  // (`pago/page.tsx`) — ce formulaire ne porte plus que les coordonnées et le paiement (spec 32).
  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
        <TextField name="holder-name" value={holderName} onChange={setHolderName} isRequired>
          <Label>{t("holderName")}</Label>
          <Input />
        </TextField>
        <PhoneField
          name="holder-phone"
          label={t("holderPhone")}
          countryLabel={t("holderPhoneCountry")}
          value={holderPhone}
          onChange={setHolderPhone}
          isRequired
          testId="holder-phone"
        />
        <TextField name="holder-email" value={holderEmail} onChange={setHolderEmail} isRequired>
          <Label>{t("holderEmail")}</Label>
          <Input type="email" />
        </TextField>

        <Checkbox
          data-testid="marketing-consent-checkbox"
          isSelected={marketingConsent}
          onChange={setMarketingConsent}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            {t("marketingConsent")}
          </Checkbox.Content>
        </Checkbox>

        <p className="text-xs text-muted">{tCommon("cancellationPolicy")}</p>

        {error ? (
          <p role="alert" data-testid="checkout-error" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" isDisabled={isSubmitting} data-testid="submit-order-button">
          {isSubmitting ? t("submitting") : t("submit")}
        </Button>

        {/* Discret, jamais devant le formulaire : le compte n'apporte qu'un confort en plus,
            jamais une obligation (correctif réservation invité). */}
        {!isAuthenticated ? (
          <Link
            href="/entrar?next=/pago"
            data-testid="login-link"
            className="text-center text-sm text-muted hover:underline"
          >
            {t("loginLink")}
          </Link>
        ) : null}
      </form>
    </div>
  );
}
