import type { NextConfig } from "next";
import { routing } from "../../i18n/routing";

type Redirect = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];

// Bascule de hifago.co (2026-10-08, décision de Gabriel) : le domaine passe de l'app legacy (Fly)
// à cette vitrine avant la reprise des données. Ses URL déjà diffusées ne doivent pas tomber en 404.
//
// - Les QR imprimés chez les partenaires et les liens de vente portent `/guatape?promo=CODE`
//   (ancien `/reservar`, déjà redirigé par le legacy) → `/[locale]/r/[code]`, la route qui pose
//   l'attribution ici et renvoie vers l'accueil, même pour un code inconnu.
// - Le portail socio, l'admin et les liens d'e-mail du legacy (invitation, réinitialisation,
//   comprobante) restent servis par l'app legacy, toujours en ligne sous son nom Fly.
//
// Toutes en 302 : elles changeront après la reprise des données (un 301 resterait en cache chez le
// visiteur). Next transmet la query d'origine à la destination, `?promo=` compris.
export const LEGACY_ORIGIN = "https://kayam-partner-portal.fly.dev";

const PROMO = [{ type: "query" as const, key: "promo", value: "(?<promo>[^&]+)" }];

export const legacyRedirects: Redirect[] = [
  ...["/guatape", "/reservar"].flatMap((source) => [
    { source, has: PROMO, destination: `/${routing.defaultLocale}/r/:promo`, permanent: false },
    { source, destination: `/${routing.defaultLocale}`, permanent: false },
  ]),
  ...["/partner/:path*", "/register", "/reset", "/admin", "/api/comprobante/:path*"].map((source) => ({
    source,
    destination: `${LEGACY_ORIGIN}${source}`,
    permanent: false,
  })),
];
