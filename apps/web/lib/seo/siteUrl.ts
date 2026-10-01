// URL publique absolue de la vitrine, et drapeau d'ouverture du référencement.
//
// Réutilise NEXT_PUBLIC_WEB_APP_URL plutôt que d'introduire une variable de plus : apps/admin
// l'emploie déjà pour désigner exactement cette URL (apps/admin/.env.example, consommée par
// partner/(app)/tools/page.tsx pour le lien de parrainage socio), et la CI la pose. Elle n'était
// simplement pas encore posée côté apps/web.

/** Repli local — même valeur que WEB_APP_URL de @hifago/e2e-support et que `next dev -p 3100`. */
const LOCAL_FALLBACK = "http://localhost:3100";

/**
 * Origine absolue du site, sans barre oblique finale.
 *
 * Volontairement JAMAIS dérivée des en-têtes de la requête (x-forwarded-host), bien que
 * packages/domain/src/http/resolveOrigin.ts sache le faire : une URL canonique qui change avec
 * l'hôte servant la requête annule exactement ce que le canonical sert à résoudre — deux hôtes
 * produiraient deux canonicals pour la même page (spec 26 §10 point C).
 *
 * ⚠️ LÈVE en production (`isProductionSite`, jamais NODE_ENV : la CI builde en production) si la
 * variable manque : le repli local y donnerait canonical, hreflang, sitemap et robots.txt sous
 * localhost — et `isIndexableSite` ouvrirait même l'indexation, localhost n'étant pas `*.vercel.app`.
 * robots.txt étant prérendu, c'est le BUILD de production qui échoue : un échec fermé et visible.
 * Hors production (preview, staging, local, CI), le repli reste.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WEB_APP_URL?.trim();
  if (!configured && isProductionSite()) {
    throw new Error(
      "NEXT_PUBLIC_WEB_APP_URL manquante en production : l'URL publique du site est obligatoire."
    );
  }
  return (configured || LOCAL_FALLBACK).replace(/\/+$/, "");
}

/**
 * Vrai uniquement sur le déploiement de production. Condition NÉCESSAIRE de l'ouverture de
 * robots.txt (voir `isIndexableSite`), et seule garde du simulateur de paiement (`mock.ts`).
 *
 * Adossé à VERCEL_ENV et JAMAIS à l'URL configurée : sur Vercel, une variable définie
 * « All Environments » ferait émettre `Allow: /` depuis CHAQUE build de preview — précisément le
 * scénario que la décision « rien n'est public » veut empêcher (spec 26 §10 point A).
 */
export function isProductionSite(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Vrai seulement si robots.txt peut s'ouvrir : production déclarée ET servie sous un vrai domaine.
 *
 * La production existe avant la bascule de domaine, publique sous `*.vercel.app` : la Deployment
 * Protection Vercel ne peut plus la cacher (elle couvrirait aussi la préprod, que les testeurs et le
 * webhook Mercado Pago doivent joindre — 2026-09-29). Sans cette garde, robots.txt dirait
 * `Allow: /` sur une URL provisoire qu'on ne veut jamais voir indexée. Le domaine ne fait que
 * RESTREINDRE, jamais ouvrir seul : l'objection de `isProductionSite` (une variable « All
 * Environments ») reste tenue, puisque VERCEL_ENV est toujours exigé. À la bascule, poser
 * NEXT_PUBLIC_WEB_APP_URL=https://hifago.co suffit — plus un redéploiement (robots.txt est
 * prérendu).
 */
export function isIndexableSite(): boolean {
  if (!isProductionSite()) return false;
  let host: string;
  try {
    host = new URL(getSiteUrl()).hostname;
  } catch {
    return false; // URL absente (getSiteUrl lève) ou illisible : échec fermé, jamais d'indexation.
  }
  return host !== "vercel.app" && !host.endsWith(".vercel.app");
}
