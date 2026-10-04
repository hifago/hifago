import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { REF_COOKIE, normalizeRefCode, refCookieOptions } from "./lib/attribution/refCookie";

const intlMiddleware = createMiddleware(routing);

// `routing.locales` ne varie jamais entre requêtes : compilée une seule fois, comme
// `intlMiddleware` ci-dessus — ce middleware tourne sur quasiment chaque requête de l'app.
const PREFIXE_LOCALE_RE = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

export default async function proxy(request: NextRequest) {
  const response = intlMiddleware(request) ?? NextResponse.next();

  // Spec 35 — `?next=<chemin>` pour la garde de `(cuenta)/layout.tsx` (un layout serveur ne connaît
  // pas le chemin courant). ⚠️ VÉRIFIÉ EN RÉEL le 2026-09-11, pas supposé : `response` ici est déjà
  // celui que retourne `intlMiddleware(request)` (rewrite ou `next()` selon la route), et un simple
  // `response.headers.set(...)` sur cet objet SURVIT jusqu'à `headers()` côté Server Component —
  // testé sur les deux chemins (`/es/cuenta/reservas` direct, et `/cuenta/reservas` qui reçoit
  // d'abord un 307 de redirection de locale : le layout ne voit alors QUE la requête suivie,
  // `/es/cuenta/reservas`, exactement celle qui porte l'en-tête). Un commentaire antérieur de ce
  // dépôt affirmait l'inverse — il partait de l'hypothèse qu'il fallait reconstruire
  // `NextResponse.next({ request: { headers } })` par-dessus le rewrite de next-intl, jamais testé.
  // ⚠️ NON RE-VÉRIFIÉ SUR VERCEL : le runtime Edge/serverless pourrait ne pas préserver cette
  // mutation de la même façon qu'en local (`next dev`, un seul processus). Sans effet en cas
  // d'échec silencieux — `(cuenta)/layout.tsx` retombe alors sur la redirection nue déjà en place.
  //
  // Le préfixe de locale est retiré ici : `LoginForm.tsx` passe `next` à `router.push()` du routeur
  // `@/i18n/navigation`, qui préfixe LUI-MÊME la locale — un chemin déjà préfixé serait doublé.
  const cheminSansLocale = request.nextUrl.pathname.replace(PREFIXE_LOCALE_RE, "");
  response.headers.set("x-hifago-pathname", cheminSansLocale || "/");

  // Feature 7 (attribution) — 2e responsabilité de ce proxy : un ?ref=<code> sur n'importe quelle
  // page pose un cookie de session. Volontairement sans maxAge/expires : perdu à la fermeture de
  // l'onglet, cohérent avec « vaut pour la réservation en cours » pour un invité — la durabilité
  // pour un compte enregistré vit côté serveur dans partner_accounts.saved_attribution_code,
  // jamais dans ce cookie. Absent de la requête → cookie existant laissé tel quel (pas effacé),
  // pour survivre à une navigation ultérieure sans ?ref= jusqu'au checkout. Un `?ref=` vide ou trop
  // long est ignoré de la même façon (`normalizeRefCode`) ; `Secure` suit le protocole réel.
  const refCode = normalizeRefCode(request.nextUrl.searchParams.get("ref"));
  if (refCode) {
    response.cookies.set(REF_COOKIE, refCode, refCookieOptions(request.nextUrl.protocol));
  }

  // Une URL sans préfixe de locale (ex. "/") reçoit déjà sa redirection 307/308 de
  // intlMiddleware ci-dessus — le navigateur va immédiatement la re-suivre et repasser par ce
  // proxy sur l'URL préfixée. Rafraîchir la session Supabase ici serait un aller-retour réseau
  // gaspillé pour une réponse dont le corps n'est jamais consommé.
  if (response.status === 307 || response.status === 308) {
    return response;
  }

  // Rafraîchit la session Supabase à chaque requête (pattern standard @supabase/ssr en
  // middleware) — sans ça, une session de connexion ne survit pas à la navigation côté serveur.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

// Cette app ne sert plus que la vitrine publique (app/[locale]) — admin/partner vivent désormais
// dans apps/admin, donc plus besoin d'exclure ces chemins de la préfixation de locale next-intl
// (l'ancien hack de cohabitation dans une seule app disparaît).
// Feature 32 : "auth" exclu comme "api" l'est déjà — sans ça, une requête vers le futur
// apps/web/app/auth/callback/route.ts (hors [locale]) serait interceptée par intlMiddleware
// (localePrefix "always", aucune locale dans /auth/callback) et redirigée vers /es/auth/callback
// (inexistant) avant même d'atteindre la route.
export const config = {
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
