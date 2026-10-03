"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { buildAuthCallbackRedirect } from "@hifago/domain";
import { createClient } from "@hifago/supabase/client";
import { Button } from "@/components/atoms/Button";
import { Aviso } from "@/components/molecules/Aviso";
import { PENDING_CART_MERGE_KEY, useCart } from "@/lib/cart/CartContext";

// Entrée Google de la vitrine (2026-09-11) — le seul morceau du parcours d'authentification que la
// feature 32 avait laissé de côté. Le cahier client §2c tranche « deux mécanismes : email/mot de
// passe ET connexion Google » depuis le 2026-08-11, et la spec 07 a construit le back-end pour les
// DEUX apps en disant explicitement « écrans côté apps/admin seulement ce lot ». Mesuré le
// 2026-09-11 avant d'écrire ce fichier : `signInWithOAuth` n'existait qu'UNE fois dans le dépôt,
// dans apps/admin.
//
// Rien d'autre ne manquait, et c'est pourquoi ce lot est court : le provider est activé
// (`supabase/config.toml` [auth.external.google]), `app/auth/callback/route.ts` traite déjà la
// branche `code` (exchangeCodeForSession) sans qu'aucun écran l'emprunte, et
// `additional_redirect_urls` porte déjà les entrées `:3100/**` avec le wildcard obligatoire — piège
// payé par la feature 31, documenté sur place.
//
// ⚠️ ADAPTÉ de `apps/admin/components/GoogleButton.tsx`, pas partagé avec lui, et ce n'est pas un
// oubli (`CLAUDE.md` §2.1 : un module ne monte dans `packages/` que s'il est prouvé consommé à
// l'identique). Trois différences réelles : il est localisé (apps/web est routée ES/EN, l'admin
// non) ; il rend son échec EN LIGNE et non en toast, parce que `SiteToaster` n'est monté nulle part
// dans apps/web — son propre en-tête le dit, et ce lot ne le corrige pas ; il passe par l'atome
// `Button` de la vitrine, dont `isPending` garde le focus et annonce l'état, là où l'admin recopiait
// `isDisabled` + libellé ternaire à la main.
//
// ⚠️ Les couleurs de la marque sont en dur et `scripts/check-tokens.sh` nomme ce fichier dans ses
// exemptions, avec la raison des drapeaux de `LanguageSwitcher` : la couleur d'un logo EST sa
// définition — la repeindre au thème la rendrait fausse, et les Google Brand Guidelines l'interdisent.
const MARQUE_GOOGLE = (
  <svg viewBox="0 0 48 48" width="18" height="18" className="shrink-0">
    <path
      fill="#EA4335"
      d="M24 9.5c3.4 0 6.4 1.2 8.8 3.5l6.6-6.6C35.3 2.5 30 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.7 6c1.9-5.7 7.2-9.7 13.8-9.7z"
    />
    <path
      fill="#4285F4"
      d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.6c-.5 3-2.2 5.4-4.6 7.1l7.4 5.7c4.3-4 6.8-9.9 6.8-17.3z"
    />
    <path
      fill="#FBBC05"
      d="M10.2 19.2 2.5 13.2C.9 16.4 0 20.1 0 24s.9 7.6 2.5 10.8l7.8-6c-.5-1.5-.8-3-.8-4.8s.3-3.3.7-4.8z"
    />
    <path
      fill="#34A853"
      d="M24 48c6 0 11.3-2 15-5.4l-7.4-5.7c-2 1.4-4.6 2.2-7.6 2.2-6.6 0-11.9-4-13.8-9.7l-7.7 6C6.5 42.6 14.6 48 24 48z"
    />
  </svg>
);

export type GoogleButtonProps = {
  /** Chemin interne où revenir après la connexion, NON préfixé de locale (comme partout ailleurs). */
  next?: string;
  testId?: string;
};

export function GoogleButton({ next = "/", testId = "google-signin-button" }: GoogleButtonProps) {
  const t = useTranslations("Common");
  const locale = useLocale();
  const { lines } = useCart();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  async function handlePress() {
    setHasFailed(false);
    setIsRedirecting(true);

    const supabase = createClient();

    // Retour Jérôme (2026-09-14) : un panier anonyme partait perdu à la connexion — corrigé pour
    // signInWithPassword dans LoginForm.tsx (lecture/écriture par le même client, avant/après). Ce
    // bouton ne peut pas faire pareil : `signInWithOAuth` fait quitter la page pour de vrai (voir
    // le commentaire sur `next` ci-dessous) — aucun état React ne survit. `sessionStorage`, lui,
    // survit à une redirection pleine page (scopé par origine+onglet, jamais par navigation) :
    // déposé ici juste avant de partir, consommé par CartContext.tsx au premier montage suivant
    // (donc sur la page d'atterrissage de `/auth/callback`, quelle qu'elle soit). `fromAccountId`
    // est ce qui empêche une double fusion si la redirection échoue avant même de partir (la
    // session resterait la MÊME identité anonyme, cf. le garde côté CartContext.tsx).
    if (lines.length > 0) {
      const {
        data: { session: sessionAnonyme },
      } = await supabase.auth.getSession();
      if (sessionAnonyme) {
        try {
          sessionStorage.setItem(
            PENDING_CART_MERGE_KEY,
            JSON.stringify({ fromAccountId: sessionAnonyme.user.id, lines })
          );
        } catch {
          /* navigation privée stricte — best-effort, jamais bloquant */
        }
      }
    }

    // ⚠️ `next` PRÉFIXÉ DE LA LOCALE COURANTE, et ce n'est pas la faute que la spec 33 vient de
    // corriger — c'en est l'inverse. Là-bas, un `/es` ÉCRIT EN DUR imposait l'espagnol à tout le
    // monde ; ici le préfixe est la langue réellement lue, donc il la PRÉSERVE. Sans lui,
    // `/auth/callback` redirigerait sur un chemin nu que le proxy relocaliserait depuis un cookie —
    // exactement le trou que `SignupForm.tsx` documente (« un anglophone y arrivait en espagnol »).
    // Le chemin traverse un domaine tiers : aucun état client ne survit, seul ce paramètre le fait.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: buildAuthCallbackRedirect({
          origin: window.location.origin,
          next: `/${locale}${next === "/" ? "" : next}`,
        }),
      },
    });

    if (error) {
      setHasFailed(true);
      setIsRedirecting(false);
    }
    // Succès : `signInWithOAuth` a DÉJÀ navigué le navigateur vers Google. Aucune redirection
    // manuelle, et `isRedirecting` reste vrai — la page est en train de partir.
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        color="neutral"
        size="lg"
        width="full"
        type="button"
        onPress={handlePress}
        isPending={isRedirecting}
        pendingLabel={t("oauth.googleRedirecting")}
        iconBefore={MARQUE_GOOGLE}
        testId={testId}
      >
        {t("oauth.google")}
      </Button>
      {hasFailed ? (
        <Aviso tono="error" rol="alert" testId={`${testId}-error`} compacto>
          <p>{t("oauth.googleError")}</p>
        </Aviso>
      ) : null}
    </div>
  );
}

export type OAuthSectionProps = {
  /** Transmis tel quel au bouton : chemin interne non préfixé. */
  next?: string;
  testId?: string;
};

/**
 * Bouton Google + séparateur, le bloc que les deux écrans qui offrent une entrée Google en plus du
 * formulaire email/mot de passe rendent à l'identique (`/entrar`, `/registro`). Un seul point de
 * vérité pour ce markup répété, comme l'`OAuthSection` de l'admin — même raison, écrite là-bas.
 */
export function OAuthSection({ next = "/", testId }: OAuthSectionProps) {
  const t = useTranslations("Common");

  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <GoogleButton next={next} />
      {/* `aria-hidden` plutôt que `role="separator"` (la forme de l'admin) : les enfants d'un
          `separator` sont présentationnels pour les technologies d'assistance, donc le mot serait
          de toute façon perdu. Le dire franchement vaut mieux que le déclarer et l'ignorer — et le
          bloc est purement décoratif, le bouton et les champs portent déjà leurs propres libellés. */}
      <div aria-hidden="true" className="flex items-center gap-3 text-sm text-muted">
        <div className="h-px flex-1 bg-border" />
        {t("oauth.separator")}
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
