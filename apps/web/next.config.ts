import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// docs/specs/04-gestion-images.md §10 — next/image charge les photos du bucket public
// catalog-media : le host est dérivé de NEXT_PUBLIC_SUPABASE_URL plutôt que codé en dur, pour
// rester valide aussi bien en local (http://127.0.0.1:54321) qu'en cloud (https://<ref>.supabase.co).
const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321");

// En-têtes de sécurité posés sur TOUTES les réponses (pages, redirections du proxy, Route Handlers,
// fichiers statiques) : `headers()` de next.config s'applique avant tout le reste du routage.
// Même liste dans apps/web/next.config.ts et apps/admin/next.config.ts — les garder alignées.
// Rien de ce site n'est destiné à être affiché dans un cadre (Checkout Pro fonctionne par
// redirection), d'où DENY et `frame-ancestors 'none'` ; la CSP s'arrête là (une CSP complète
// demanderait d'inventorier les scripts inline de Next et de HeroUI). Pas de
// Cross-Origin-Opener-Policy : `same-origin` casserait la fenêtre de connexion Google (leçon du
// legacy, helmet). HSTS est posé par Vercel.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

// Garde anti-SSRF de next/image levée UNIQUEMENT pour une instance Supabase locale — décidé sur
// l'hôte réel, jamais sur NODE_ENV : la CI et les e2e buildent en production contre 127.0.0.1.
const LOCAL_SUPABASE = ["127.0.0.1", "localhost", "[::1]"].includes(supabaseUrl.hostname);

const nextConfig: NextConfig = {
  // Le monorepo hifago/ (deux niveaux au-dessus de cette app) a son propre package-lock.json,
  // distinct de celui de l'app legacy à la racine du dépôt — sans ceci Turbopack remonte par
  // erreur à la racine du dépôt comme workspace root.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  // Packages "source" du monorepo (pas de dist/ pré-buildé) — transpilePackages fait que
  // Next.js les transpile comme du code applicatif.
  transpilePackages: ["@hifago/ui", "@hifago/supabase", "@hifago/domain"],
  images: {
    remotePatterns: [
      {
        protocol: supabaseUrl.protocol.replace(":", "") as "http" | "https",
        hostname: supabaseUrl.hostname,
        port: supabaseUrl.port || undefined,
        pathname: "/storage/v1/object/public/catalog-media/**",
      },
    ],
    // Garde anti-SSRF de Next 16 (bloque par défaut les IP privées comme 127.0.0.1) : levée pour la
    // pile locale seulement, cf. LOCAL_SUPABASE ci-dessus.
    dangerouslyAllowLocalIP: LOCAL_SUPABASE,
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  // Feature 32 — runbook tunnel Mercado Pago (docs/journal/2026-08.md, 2026-08-20 suite 8) :
  // Next 16 bloque par défaut les requêtes cross-origin vers le dev server. Nécessaire
  // uniquement pour naviguer via l'URL publique du tunnel cloudflared (jamais utilisé sinon,
  // aucun risque en local pur) — l'URL exacte change à chaque lancement (tunnel éphémère, sans
  // compte), d'où le wildcard plutôt qu'un hôte fixe.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
