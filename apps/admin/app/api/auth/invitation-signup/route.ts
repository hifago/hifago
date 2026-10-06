import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { meetsPasswordPolicy } from "@hifago/domain";

// Feature 31 (docs/specs/07-connexion-inscription-complete.md §7) — remplace l'appel client
// supabase.auth.signUp() de JoinForm.tsx : maintenant que enable_confirmations = true, un signUp
// client-side ne renverrait plus de session immédiate, ce qui casserait l'atterrissage instantané
// de /partner/join (Feature 29). Ce Route Handler crée le compte déjà confirmé (service_role,
// admin.createUser({email_confirm:true})), établit la session, puis CONSOMME l'invitation sur
// cette même session, dans la même requête : consume_partner_invitation reste l'unique autorité de
// consommation du jeton (auth.uid(), verrou FOR UPDATE), mais le jeton n'est plus jamais laissé
// réutilisable entre la création d'un compte et sa consommation par le navigateur. Tout échec
// après la création supprime le compte : une invitation ne produit jamais de compte sans rôle.
//
// Pré-contrôle en lecture seule via la RPC check_partner_invitation (SECURITY DEFINER) — PAS une
// lecture directe de partner_invitations via service_role : cette table est RPC-only (revoke
// insert/update/delete ET aucun GRANT SELECT à service_role, 20260813163456_identity_rls.sql),
// service_role contourne la RLS mais jamais l'absence de GRANT, "permission denied for table
// partner_invitations" constaté en écrivant cette route. Préserve l'invariant déjà testé « une
// invitation invalide échoue sans créer de compte partiel » (docs/5-conception/roles-composables.md
// §9) — une fenêtre de concurrence résiduelle entre ce pré-contrôle et l'appel RPC réel reste
// possible (cas limite documenté §9 de la spec) : elle se referme désormais par la suppression du
// compte créé, jamais par un compte orphelin.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { token?: string; email?: string; password?: string; name?: unknown }
    | null;
  const token = body?.token;
  const email = body?.email;
  const password = body?.password;
  // Nom du signataire des conditions (role_agreements.signer_name) : le formulaire est en
  // `noValidate`, l'obligation se vérifie donc ici.
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!token || !email || !password || !name) {
    return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  }
  // La règle de mot de passe (8 caractères, lettres et chiffres) se vérifie ICI, avant toute
  // lecture : JoinForm la dit déjà, mais un appel direct à cette route ne passe pas par lui. Et
  // vérifiée avant `admin.createUser`, elle donne la bonne raison : un refus de la création se
  // lirait sinon `email_already_used` (ci-dessous).
  if (typeof password !== "string" || !meetsPasswordPolicy(password)) {
    return Response.json({ ok: false, reason: "weak_password" }, { status: 400 });
  }

  const supabaseAnon = await createClient();
  const { data: check, error: checkError } = await supabaseAnon.rpc("check_partner_invitation", {
    p_token: token,
  });
  const checkResult = check as { ok: boolean; reason?: string } | null;
  if (checkError || !checkResult?.ok) {
    return Response.json(
      { ok: false, reason: checkResult?.reason ?? "invitation_not_found" },
      { status: 404 }
    );
  }

  const service = createServiceRoleClient();
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    // Jamais de détail (fuite d'existence de compte) — email déjà pris est la cause la plus
    // probable, mais le message reste générique.
    return Response.json({ ok: false, reason: "email_already_used" }, { status: 409 });
  }
  const userId = created.user.id;

  // Établit la session (cookies) sur cette même réponse — le compte vient d'être créé confirmé,
  // ce signInWithPassword ne peut échouer que sur une incohérence interne.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    await supprimerCompte(service, supabase, userId);
    return Response.json({ ok: false, reason: "session_failed" }, { status: 500 });
  }

  // Sur CE client, jamais `supabaseAnon` : c'est lui qui porte la session du nouveau compte, que
  // consume_partner_invitation lit par auth.uid(). p_document_version : même valeur que la
  // branche « session existante » de JoinForm.tsx.
  const { data: consumed, error: consumeError } = await supabase.rpc("consume_partner_invitation", {
    p_token: token,
    p_signer_name: name,
    p_document_version: "v1",
  });
  const consumeResult = consumed as { ok: boolean; reason?: string } | null;
  if (consumeError || !consumeResult) {
    await supprimerCompte(service, supabase, userId);
    return Response.json({ ok: false, reason: "consume_failed" }, { status: 503 });
  }
  if (!consumeResult.ok) {
    await supprimerCompte(service, supabase, userId);
    return Response.json(
      { ok: false, reason: consumeResult.reason ?? "consume_failed" },
      { status: 409 }
    );
  }

  return Response.json({ ok: true });
}

// Défait la création d'un compte que l'invitation n'a finalement pas rattaché. Un échec de la
// suppression est journalisé sans changer la réponse : le compte resté sans rôle ne donne accès à
// rien (aucun partner_id, aucune capacité), et la session est fermée quoi qu'il arrive.
async function supprimerCompte(service: SupabaseClient, supabase: SupabaseClient, userId: string) {
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error) {
    console.error("invitation-signup : compte non supprimé après un échec d'inscription", {
      userId,
      message: error.message,
    });
  }
  await supabase.auth.signOut();
}
