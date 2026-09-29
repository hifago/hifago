import { NextResponse } from "next/server";
import { createClient } from "@hifago/supabase/server";
import { resolveOrigin, safeNextPath } from "@hifago/domain";

const EMAIL_OTP_TYPES = ["signup", "recovery", "email_change", "invite", "email"] as const;
type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return EMAIL_OTP_TYPES.includes(value as EmailOtpType);
}

// Sous-ensemble simplifié de apps/admin/app/auth/callback/route.ts (feature 32) : point
// d'atterrissage pour la confirmation d'inscription client (verifyOtp, token_hash construit par
// supabase/templates/confirmation.html via {{ .RedirectTo }}) — et pour un futur flux OAuth
// (exchangeCodeForSession), non utilisé aujourd'hui côté apps/web (pas de Google ici, hors
// périmètre feature 32). PAS de nettoyage de compte fantôme ni de garde MFA/AAL2 : les deux sont
// spécifiques à is_admin()/AAL2 (admin uniquement) — un client n'a ni capacité ni 2FA à vérifier.
// Route Handler (pas une Server Action) : seul un vrai handler de requête écrit les cookies de
// session sur la réponse de redirection. Hors [locale] (comme app/api/*) — apps/web/proxy.ts
// exclut explicitement "auth" de son matcher pour que cette route ne soit jamais interceptée par
// le middleware next-intl.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next");
  // Jamais une redirection ouverte : uniquement un chemin interne au site.
  const next = safeNextPath(nextParam);
  // Même piège que api/payments/create/route.ts (feature 32) : request.url seul retombe sur
  // l'adresse locale du serveur derrière un reverse proxy/tunnel — X-Forwarded-Host prime.
  const origin = resolveOrigin({
    requestUrl: request.url,
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
  });

  const supabase = await createClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && isEmailOtpType(type)
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing_code_or_token_hash") };

  if (error) {
    return NextResponse.redirect(new URL("/entrar?error=auth_callback_failed", origin));
  }

  // Spec 33 Tranche 3 — rattachement des commandes passées en invité (cahier client §2b.9 :
  // « créer un compte depuis cet écran rattache les commandes par adresse email »).
  //
  // ICI ET NULLE PART AILLEURS : c'est l'unique instant du parcours où l'email vient d'être
  // VÉRIFIÉ et où une session existe. La RPC refuse tout email non confirmé — c'est son seul
  // rempart contre le pre-account takeover — donc l'appeler plus tôt (à l'inscription) ne
  // rattacherait jamais rien, et plus tard demanderait un déclencheur qui n'existe pas.
  //
  // Sans paramètre, délibérément : elle lit `auth.uid()` et l'email de `auth.users` elle-même.
  // Un email transmis d'ici serait exactement l'attaque qu'elle empêche.
  //
  // ⚠️ Un échec n'interrompt JAMAIS la redirection. Le compte vient d'être créé et vérifié : c'est
  // l'essentiel du geste que le client a demandé, et un rattachement raté le laisse devant une
  // liste de réservations vide — gênant, jamais bloquant.
  //
  // ⚠️ MAIS IL N'Y A PAS DE RATTRAPAGE AUTOMATIQUE, et il ne faut pas le croire : une connexion
  // ultérieure ne repasse PAS par ici (`LoginForm` utilise `signInWithPassword`, qui ne traverse
  // jamais ce callback). Un échec réseau ici n'est donc jamais rejoué. La RPC est idempotente et
  // supporterait d'être appelée à chaque session réelle — l'accrocher à l'invariant plutôt qu'à cet
  // événement est le geste plus profond, laissé ouvert au §10 de la spec 33 faute d'arbitrage : le
  // cahier §2b.9 ne vise que le compte créé DEPUIS l'écran de résultat, qui passe bien par ici.
  const { error: attachError } = await supabase.rpc("attach_orders_to_account");
  if (attachError) {
    console.error("attach_orders_to_account a échoué après vérification d'email", attachError);
  }

  return NextResponse.redirect(new URL(next, origin));
}
