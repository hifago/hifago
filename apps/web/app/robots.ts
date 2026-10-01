import type { MetadataRoute } from "next";
import { getSiteUrl, isIndexableSite } from "@/lib/seo/siteUrl";
import { routing } from "@/i18n/routing";

// DÉCISION Jérôme 2026-09-01 : TOUS les crawlers IA sont autorisés en production — GPTBot,
// ClaudeBot, Google-Extended, PerplexityBot, OAI-SearchBot, ChatGPT-User, CCBot… Pour Hifago,
// être cité comme source dans une réponse d'IA est de l'acquisition, pas du pillage.
//
// ⚠️ Cette décision se documente ICI, en commentaire, et NON par des groupes `User-Agent:` nommés
// dans le fichier servi. Un crawler n'obéit qu'au groupe le plus spécifique qui le nomme et
// IGNORE alors le groupe `*` : un groupe `User-Agent: GPTBot / Allow: /` qui ne répéterait pas
// les Disallow ci-dessous autoriserait GPTBot précisément là où le groupe générique l'interdit.
// Le groupe `*` en `Allow: /` suffit à tout autoriser (spec 26 §5.1).

/**
 * Routes sans aucun contenu indexable — exclues pour économiser le budget de crawl, jamais pour
 * empêcher une indexation (ça, c'est le rôle de `robots: { index: false }` en metadata : une page
 * en Disallow n'est jamais chargée, donc son noindex n'est jamais lu).
 *
 * `/{locale}/r/` : redirections d'attribution derrière les QR imprimés — sans contenu propre, et
 * chaque passage de crawler y fabrique une visite attribuée parasite.
 *
 * `/{locale}/reserva/` : l'écran de résultat d'une commande (spec 33). ⚠️ SEULE entrée de cette
 * liste dont la raison n'est PAS le budget de crawl — c'est la seule qui protège des données
 * personnelles (nom, téléphone, email du client, cahier §2b.9). Le geste voulu est donc bien
 * d'empêcher le CHARGEMENT de la page par un robot, pas seulement son indexation : d'où un
 * Disallow, et AUCUN `robots: { index: false }` sur la page elle-même — les deux ensemble
 * s'annulent, une page en Disallow n'étant jamais chargée, son noindex n'est jamais lu
 * (`.claude/rules/seo.md` règle 5).
 */
// ⚠️ DÉRIVÉ de `routing.locales`, jamais énuméré à la main : ajouter une 3e locale exposerait
// sinon `/pt/reserva/<jeton>` aux crawlers — c'est-à-dire des données personnelles, pas seulement
// du budget de crawl. Les deux chemins non localisés restent écrits en clair (ils vivent hors de
// `[locale]`).
const CHEMINS_LOCALISES = ["r", "reserva"];
const DISALLOW = [
  ...routing.locales.flatMap((locale) => CHEMINS_LOCALISES.map((chemin) => `/${locale}/${chemin}/`)),
  "/auth/",
  "/api/",
];

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  // Rien n'est public tant que le déploiement ne se déclare pas « production » ET ne sert pas le
  // vrai domaine : une préprod indexée cannibalise le vrai site, et la prod provisoire sous
  // `*.vercel.app` (avant la bascule) ne doit jamais entrer dans l'index (`isIndexableSite`).
  // Aucun `sitemap:` n'est annoncé ici — on n'indique pas un plan de site qu'on refuse par ailleurs
  // de faire crawler.
  //
  // ⚠️ robots.txt est PRÉRENDU AU BUILD : basculer ce drapeau exige un REDÉPLOIEMENT, pas
  // seulement un changement de variable d'environnement.
  if (!isIndexableSite()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/", disallow: DISALLOW },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
