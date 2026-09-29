import { NextResponse } from "next/server";
import { safeNextPath } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { checkMfaGuard } from "@/lib/mfaGuard";

const EMAIL_OTP_TYPES = ["signup", "recovery", "email_change", "invite", "email"] as const;
type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return EMAIL_OTP_TYPES.includes(value as EmailOtpType);
}

// Feature 31 — révision 2026-08-19 (3e passe, docs/specs/07-connexion-inscription-complete.md §8/
// §10) : GoTrue lui-même ne peut pas distinguer "Google depuis /login, personne inconnue" de
// "Google depuis /partner/join, jeton d'invitation valide" — mais CETTE route, elle, le peut : le
// bouton Google (GoogleButton.tsx) encode déjà `next` dans `redirectTo` AVANT de partir vers
// Google, et GoTrue nous le restitue tel quel sur le retour. On peut donc nettoyer APRÈS coup un
// compte que GoTrue vient de créer silencieusement, si ce n'est pas dans le contexte d'une
// invitation — sans jamais avoir eu besoin de bloquer la création en amont (`enable_signup` reste
// `true`, cf. le revirement de cette même journée). Champ d'application : le flux OAuth (`code`)
// ET la confirmation email d'une inscription (`type=signup`) — jamais `recovery`/`email_change`/
// `invite`, qui concernent toujours un compte déjà existant.
function isFreshAccountCreation(type: string | null, hasCode: boolean) {
  return hasCode || type === "signup";
}

// Un compte dont `last_sign_in_at` est à quelques secondes de `created_at` vient d'être créé PAR
// CETTE requête — un compte de retour (même via Google, même via un lien email tardif) porte un
// `last_sign_in_at` largement postérieur à sa création originale. Robuste au délai de remise d'un
// email de confirmation (jamais un simple "created_at récent par rapport à maintenant").
function wasJustCreated(user: { created_at: string; last_sign_in_at?: string | null }) {
  if (!user.last_sign_in_at) return true;
  const delta = Math.abs(
    new Date(user.last_sign_in_at).getTime() - new Date(user.created_at).getTime()
  );
  return delta < 5000;
}

// Contexte d'invitation établi sur l'ÉTAT RÉEL, pas sur la seule destination : `next` vient de
// l'URL, donc de quiconque a construit le lien. Le compte fraîchement créé n'est gardé que si `next`
// (déjà filtré par safeNextPath) mène exactement à /partner/join avec un jeton que
// check_partner_invitation déclare encore valide — une erreur de vérification vaut refus.
async function arrivesWithValidInvitation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  next: string,
  origin: string
) {
  const target = new URL(next, origin);
  const token = target.pathname === "/partner/join" ? target.searchParams.get("token") : null;
  if (!token) return false;
  const { data, error } = await supabase.rpc("check_partner_invitation", { p_token: token });
  return !error && (data as { ok?: boolean } | null)?.ok === true;
}

// Feature 31 (docs/specs/07-connexion-inscription-complete.md §5) — point d'atterrissage unique
// pour deux flux distincts : l'échange de code OAuth Google (exchangeCodeForSession) et la
// vérification des liens email construits avec {{ .TokenHash }} (verifyOtp), jamais le
// {{ .ConfirmationURL }} par défaut de Supabase (vulnérable au pré-fetch des scanners d'email).
// Route Handler, jamais une Server Action : seul un vrai handler de requête peut écrire les cookies
// de session sur la réponse de redirection.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next");
  // Jamais une redirection ouverte : uniquement un chemin interne au site, même garde que
  // login/page.tsx.
  const next = safeNextPath(nextParam);

  const supabase = await createClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && isEmailOtpType(type)
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing_code_or_token_hash") };

  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth_callback_failed", url.origin));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Nettoyage a posteriori (voir commentaire de fonction ci-dessus) — avant toute autre logique
  // (2FA compris), un compte fantôme ne doit jamais atteindre /mfa/* ni la destination finale.
  if (user && isFreshAccountCreation(type, Boolean(code)) && wasJustCreated(user)) {
    if (!(await arrivesWithValidInvitation(supabase, next, url.origin))) {
      const service = createServiceRoleClient();
      await service.auth.admin.deleteUser(user.id);
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=google_signup_blocked", url.origin));
    }
  }

  // 2FA admin déclenchée à la connexion elle-même (§8) — un compte admin qui vient de confirmer
  // son email ou de se connecter via Google n'échappe pas à l'AAL2.
  if (user) {
    const mfa = await checkMfaGuard(supabase, user.id);
    if (mfa.action === "enroll") {
      return NextResponse.redirect(
        new URL(`/mfa/enroll?next=${encodeURIComponent(next)}`, url.origin)
      );
    }
    if (mfa.action === "verify") {
      return NextResponse.redirect(
        new URL(`/mfa/verify?next=${encodeURIComponent(next)}`, url.origin)
      );
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
