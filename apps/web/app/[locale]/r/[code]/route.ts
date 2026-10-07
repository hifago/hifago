import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { createClient } from "@hifago/supabase/server";
import { routing } from "@/i18n/routing";

// Feature 18 — Socio : obtenir son lien/QR de vente attribué. Le QR/lien imprimé pointe TOUJOURS
// ici, jamais vers l'URL finale (cahier des charges socio §3h, tranché par Jérôme le 2026-08-13) :
// un support déjà imprimé reste valide même si la structure d'URL change plus tard. Reste sous
// [locale] (pas une route racine /r/[code] plus courte) : le matcher de proxy.ts
// ("/((?!api|_next|_vercel|admin|partner|.*\\..*).*)") n'exclut que api/_next/_vercel/admin/partner
// et les fichiers statiques — /[locale]/r/[code] y est donc déjà couvert sans aucune modification
// du matcher ni du middleware next-intl.
//
// Se contente de réinjecter ?ref=<code> sur l'accueil — AUCUNE nouvelle logique de cookie ici :
// proxy.ts (feature 7) pose déjà le cookie hifago_ref à partir de ce paramètre au prochain hit,
// et create_order (feature 7/§attribution) résout ensuite ce code exactement comme ci-dessous
// (`where code = ... and active = true`, cf. supabase/migrations/20260814093000_create_order_attribution.sql).
export async function GET(request: NextRequest, context: RouteContext<"/[locale]/r/[code]">) {
  const params = await context.params;
  const { code } = params;
  // Locale revalidée ICI : tous les chemins n'atteignent pas ce handler en passant par le proxy
  // next-intl (son matcher exclut, entre autres, tout chemin contenant un point). Une locale
  // inconnue retombe sur l'espagnol — jamais un 404 pour un QR déjà imprimé.
  const locale = hasLocale(routing.locales, params.locale) ? params.locale : routing.defaultLocale;

  // partner_codes_select_public (Tranche 1, `using (true)`) : lecture publique déjà ouverte, un
  // code doit être vérifiable avant inscription — même policy réutilisée ici, aucune nouvelle
  // policy ni RPC. Code inconnu/inactif → même redirection, SANS ?ref= : jamais de page d'erreur
  // pour un QR déjà imprimé, cohérent avec "un code invalide n'empêche jamais la réservation".
  //
  // Lecture EN PANNE : on ne sait pas si le code est actif, et l'écarter perdrait l'attribution
  // d'un QR imprimé valide. On garde donc ?ref= : create_order revérifie le code (actif, existant)
  // au moment de la commande, et ignore un code invalide — le doute coûte au plus un paramètre inutile.
  const supabase = await createClient();
  const { data: partnerCode, error } = await supabase
    .from("partner_codes")
    .select("code")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) console.error("r/[code] : lecture de partner_codes impossible, ?ref= conservé", error.message);

  const target =
    partnerCode || error
      ? new URL(`/${locale}?ref=${encodeURIComponent(code)}`, request.url)
      : new URL(`/${locale}`, request.url);

  return Response.redirect(target, 302);
}
