// Prépare un compte admin LOCAL pour une connexion par Google (bouton « Continuar con Google » de
// apps/admin, /login) — base locale uniquement, jamais la préprod ni la prod.
//
// Pourquoi ce script existe : apps/admin/app/auth/callback/route.ts supprime tout compte que Google
// vient de créer hors invitation (`google_signup_blocked`, spec 07 §8/§10). Un Gmail ne peut donc
// se connecter par Google que si son compte existe DÉJÀ, email confirmé — GoTrue rattache alors
// l'identité Google au compte existant (même email vérifié) au lieu d'en créer un. Et sans capacité
// admin, la connexion aboutit sur un compte sans aucun droit.
//
// Volontairement HORS de seed_auth_users.mjs / seed.sql : le seed est synthétique (aucune adresse
// réelle), rejoué sur la préprod, et un second admin y changerait ce que comptent les tests. Ici
// rien n'est automatique : à relancer après chaque `npm run db:setup` (qui efface la base locale).
//
// Idempotent : compte déjà présent → réutilisé ; capacité admin déjà active → rien n'est écrit.
// Aucun mot de passe n'est posé (connexion par Google seulement) et aucun facteur 2FA n'est
// enrôlé : à la première connexion Google, /auth/callback envoie donc sur /mfa/enroll (checkMfaGuard),
// comme sur la préprod.
//
// Usage (les deux variables viennent du .env.local de l'app admin, rien n'est affiché) :
//   npm run db:google-admin -- hifagotest@gmail.com

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2]?.trim().toLowerCase();

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY sont requis en " +
      "variables d'environnement (jamais de valeur par défaut codée en dur ici — cf. hifago/CLAUDE.md §8.2)."
  );
  process.exit(1);
}

if (!email || !email.includes("@")) {
  console.error("Usage : npm run db:google-admin -- <adresse Gmail>");
  process.exit(1);
}

// Ce script ACCORDE une capacité admin : il refuse toute cible qui n'est pas la stack Docker locale.
// Le premier admin d'un projet cloud se pose à la main, après /hifago-verify-compte (CLAUDE.md §8.1).
const HOTES_LOCAUX = ["127.0.0.1", "localhost"];
if (!HOTES_LOCAUX.includes(new URL(SUPABASE_URL).hostname)) {
  console.error(`Refusé : ${new URL(SUPABASE_URL).host} n'est pas la base locale.`);
  process.exit(1);
}

async function findUserByEmail(service) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`lecture des comptes a échoué : ${error.message}`);
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found || data.users.length < 200) return found ?? null;
  }
}

async function main() {
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let user = await findUserByEmail(service);
  if (user) {
    console.log(`= compte déjà présent : ${email} (${user.id})`);
  } else {
    // createUser() déclenche on_auth_user_created, qui provisionne partner_accounts — la clé
    // étrangère de la capacité ci-dessous en dépend.
    const { data, error } = await service.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw new Error(`création ${email} a échoué : ${error.message}`);
    user = data.user;
    console.log(`✓ compte créé : ${email} (${user.id})`);
  }

  if (!user.email_confirmed_at) {
    throw new Error(
      `${email} existe mais son email n'est pas confirmé : Google ne s'y rattacherait pas. ` +
        "Confirmer le compte (ou le supprimer) puis relancer."
    );
  }

  const { data: capabilities, error: readError } = await service
    .from("partner_capabilities")
    .select("id, status")
    .eq("account_id", user.id)
    .eq("role", "admin");
  if (readError) throw new Error(`lecture de la capacité admin a échoué : ${readError.message}`);

  if (capabilities.some((capability) => capability.status === "active")) {
    console.log("= capacité admin déjà active");
  } else if (capabilities.length) {
    throw new Error("une capacité admin existe mais elle est suspendue — à réactiver depuis l'admin.");
  } else {
    // Même ligne que l'admin du seed (seed.sql, Feature 1) : capacité admin account_id-scoped,
    // jamais partner_id-scoped (contrainte partner_capabilities_scope).
    const { error } = await service
      .from("partner_capabilities")
      .insert({ account_id: user.id, role: "admin", source: "migration", status: "active" });
    if (error) throw new Error(`insertion de la capacité admin a échoué : ${error.message}`);
    console.log("✓ capacité admin accordée");
  }

  console.log(`==> ${email} peut se connecter par Google sur l'admin local (port 3101)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
