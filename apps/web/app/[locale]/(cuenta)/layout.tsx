import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { createClient } from "@hifago/supabase/server";
import { isRealAccount } from "@hifago/supabase/identity";
import { redirect } from "@/i18n/navigation";
import { SiteHeader } from "@/components/organisms/SiteHeader";
import { SiteFooter } from "@/components/organisms/SiteFooter";

// Zone COMPTE — la SEULE garde d'accès du site (spec 27 §5). Jamais indexée.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI LA GARDE EST ICI, ET PAS DANS `proxy.ts`
// ─────────────────────────────────────────────────────────────────────────────────────────────
// La documentation Supabase déconseille de faire porter l'AUTORISATION au middleware, et le proxy
// ne voit ni les rôles ni la ressource visée — il rafraîchit la session, c'est tout. Une garde de
// layout, elle, s'exécute au plus près de ce qu'elle protège et couvre d'un coup tous les écrans
// de la zone : la précédente vivait dans `account/orders/page.tsx` et n'aurait couvert aucun écran
// de compte ajouté après elle.
//
// ⚠️ L'invité doit pouvoir réserver de BOUT EN BOUT (cahier §1) : il n'y a donc aucune garde sur la
// vitrine ni sur le tunnel. Ajouter une garde ailleurs que dans cette zone serait une régression
// fonctionnelle, pas un durcissement.
//
// ⚠️ CORRIGÉ le 2026-09-11 (spec 35) : la garde était `if (!user)`, qui laisse passer une session
// ANONYME — `getUser()` en rend une depuis la spec 31. C'est exactement le trou que la spec 34
// (décision ⑦) a fermé sur `/cuenta/reservas` seule, en le délégant explicitement ici : « la
// décision ⑦ vaut pour toute la zone ». `isRealAccount` (même prédicat que `CoquillaVitrine`,
// `pago/page.tsx`, `viewerIsRealAccount`) ferme le trou pour toute la zone d'un coup.
//
// ⚠️ `?next=<chemin>` — RÉSOLU le 2026-09-11 (spec 35), contrairement à ce que ce commentaire
// affirmait jusque-là. `proxy.ts` pose désormais `x-hifago-pathname` (le chemin courant, préfixe de
// locale retiré) sur la réponse d'`intlMiddleware` — un simple `response.headers.set(...)` suffit,
// **vérifié en réel** (voir `proxy.ts` pour le détail et sa réserve : non re-testé sur Vercel).
// Repli automatique et silencieux si l'en-tête manque : `next` reste alors absent, exactement le
// comportement d'avant.

export const metadata: Metadata = { robots: { index: false } };

export default async function CuentaLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isRealAccount(user)) {
    const chemin = (await headers()).get("x-hifago-pathname");
    const href = chemin ? `/entrar?next=${encodeURIComponent(chemin)}` : "/entrar";
    redirect({ href, locale });
  }

  return (
    <>
      {/* `isAuthenticated={true}` en dur : le guard ci-dessus vient de le garantir — même geste
          que `pago/page.tsx` passant `isRealAccount(user)` à `CheckoutForm`. `SiteHeader` est un
          Client Component ; `CartProvider` est monté à `[locale]/layout.tsx`, au-dessus de
          `(vitrine)` ET `(cuenta)` — `useCart()` y fonctionne déjà sans rien remonter. */}
      <SiteHeader isAuthenticated={true} testId="site-header" />
      {children}
      {/* Le pied marine, comme la vitrine (plan 41, C2 ; arbitrage D3 : « zone compte comprise »).
          La zone n'en avait aucun. Le TUNNEL, lui, reste sans pied, volontairement
          (`CoquillaTunel`). */}
      <SiteFooter />
    </>
  );
}
