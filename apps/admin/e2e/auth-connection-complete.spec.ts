import { test, expect, type Page } from "@playwright/test";
import {
  generateTotp,
  withDb,
  latestCallbackLink,
  createTestUser,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  ADMIN_APP_URL,
} from "@hifago/e2e-support";

// Feature 31 — révision 2026-08-19, 3e passe (docs/specs/07-connexion-inscription-complete.md
// §10) : inscription libre neutralisée au niveau UI (`/signup` redirige vers `/login`, aucun lien
// « Crear cuenta ») mais le bouton Google, lui, RESTE proposé sur `/login` (et `/partner/join`,
// cf. partner-join.spec.ts) — un blocage global (`enable_signup=false`, 2e passe) cassait aussi
// l'acceptation d'invitation via Google (retour réel de Jérôme), abandonné. À la place,
// `app/auth/callback/route.ts` nettoie a posteriori tout compte fraîchement créé (Google OU
// confirmation email `type=signup`) qui n'arrive pas via `/partner/join` — testé ci-dessous via le
// chemin email (`POST /auth/v1/signup` brut + lien de confirmation Mailpit réel), qui partage
// exactement la même logique de nettoyage que Google (jamais piloté en e2e, hifago/CLAUDE.md §6
// point 2).
test("/signup redirige et le lien « Crear cuenta » disparaît de /login ; le bouton Google, lui, reste proposé", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.waitForURL(/\/login/);

  await expect(page.locator('a[href="/signup"]')).toHaveCount(0);
  await expect(page.getByTestId("google-signin-button")).toBeVisible();
});

test("un compte fraîchement créé hors contexte d'invitation est supprimé au retour du callback, avec message clair", async ({
  page,
  request,
}) => {
  const email = `e2e-fresh-outside-invite-${Date.now()}@test.local`;
  // Feature 32 : confirmation.html construit désormais son lien depuis {{ .RedirectTo }}
  // (dynamique, apps/web a aussi son propre /auth/callback depuis cette feature) plutôt qu'un
  // localhost:3101/auth/callback?...&next=/partner codé en dur — un appel signup SANS redirect_to
  // retomberait sur site_url nu (sans query string), un lien cassé. `redirect_to` passé
  // explicitement ici (paramètre de requête brut, cf. GoTrueClient.js) pour reproduire exactement
  // l'ancien comportement testé : next=/partner, jamais /partner/join, donc bien traité comme
  // "hors invitation" par la route de nettoyage.
  const redirectTo = new URL("/auth/callback", ADMIN_APP_URL);
  redirectTo.searchParams.set("next", "/partner");
  const signupResponse = await request.post(
    `${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo.toString())}`,
    {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: { email, password: "FreshOutside1234!" },
    }
  );
  expect(signupResponse.ok()).toBe(true);

  const confirmLink = await latestCallbackLink(request, email);
  await page.goto(confirmLink);
  await page.waitForURL(/\/login\?error=google_signup_blocked/);
  // .first() : React StrictMode (dev) peut monter LoginForm deux fois et donc déclencher ce toast
  // deux fois — comportement déjà documenté et accepté (hifago/CLAUDE.md §11), sans effet en
  // production ; on vérifie juste qu'au moins une occurrence est visible.
  await expect(page.getByText(/no tiene cuenta todavía/).first()).toBeVisible();

  const stillExists = await withDb(async (client) => {
    const { rows } = await client.query("select 1 from auth.users where email = $1", [email]);
    return rows.length > 0;
  });
  expect(stillExists).toBe(false);
});

test("connexion sur un compte non confirmé redirige vers /verify-email", async ({ page }) => {
  const email = `e2e-unconfirmed-${Date.now()}@test.local`;
  await createTestUser(email, "UnconfirmedE2E1234!", { confirmed: false });

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("UnconfirmedE2E1234!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/verify-email/);
  await expect(page.getByText(email)).toBeVisible();
});

test("mot de passe oublié : email générique, lien réel, reconnexion avec le nouveau mot de passe", async ({
  page,
  request,
  context,
}) => {
  const email = `e2e-forgot-${Date.now()}@test.local`;
  await createTestUser(email, "OldPassword123!");

  await page.goto("/forgot-password");
  await page.locator('input[name="email"]').fill(email);
  await page.getByTestId("forgot-password-submit").click();
  await expect(page.getByTestId("forgot-password-sent")).toBeVisible();

  const resetLink = await latestCallbackLink(request, email);
  await page.goto(resetLink);
  await page.waitForURL(/\/reset-password/);
  await page.locator('input[name="password"]').fill("NewPassword456!");
  await page.locator('input[name="confirm-password"]').fill("NewPassword456!");
  await page.getByTestId("reset-password-submit").click();
  await page.waitForURL(/\/partner$|\/$/);

  await context.clearCookies();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("NewPassword456!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/partner$/);
});

// Création d'un compte admin dédié (jamais le seed admin@hifago.test, déjà enrôlé par supabase/seed.sql
// pour les autres specs via packages/e2e-support) — capacité admin accordée directement en base
// (même idiome que setPartnerCodeActive/resetAvailability, packages/e2e-support/src/db.ts), pas via
// un flux d'invitation qui n'existe pas pour ce rôle.
async function creerAdminDedie(prefixe: string, motDePasse: string) {
  const email = `${prefixe}-${Date.now()}@test.local`;
  await createTestUser(email, motDePasse);
  await withDb(async (client) => {
    await client.query(
      `insert into partner_capabilities (account_id, role, source, status)
       select id, 'admin', 'migration', 'active' from auth.users where email = $1`,
      [email]
    );
  });
  return email;
}

async function seConnecter(page: Page, email: string, motDePasse: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(motDePasse);
  await page.locator('button[type="submit"]').click();
}

test("2FA admin : jamais forcé, activable depuis « Seguridad », puis exigé à chaque connexion", async ({
  page,
  context,
}) => {
  // Spec 07 §10 (révision 2026-10-30) : le 2FA est un CHOIX. Un admin qui n'a rien activé arrive
  // directement sur /admin. Qui l'a activé le passe à chaque connexion (mot de passe comme Google),
  // et is_admin() exige alors l'AAL2 (20261030090000_admin_2fa_si_active.sql).
  const motDePasse = "TwoFaAdmin1234!";
  const email = await creerAdminDedie("e2e-2fa-admin", motDePasse);

  await seConnecter(page, email, motDePasse);
  await page.waitForURL(/\/admin$/);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  // Activation volontaire depuis la modale (chemin principal, plus un écran isolé).
  await page.getByTestId("security-button-nav").click();
  await expect(page.getByTestId("security-dialog")).toBeVisible();
  await expect(page.getByTestId("security-status")).toHaveText("No activada");
  await page.getByTestId("security-enable").click();
  const secret = await page.getByTestId("mfa-secret").innerText();
  await page.locator('input[name="code"]').fill(generateTotp(secret));
  await page.getByTestId("mfa-enroll-submit").click();
  await expect(page.getByTestId("security-status")).toHaveText("Activada");
  // Un seul appareil : la modale recommande le second (pas de codes de secours chez Supabase).
  await expect(page.getByTestId("security-backup-hint")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();

  // Nouvelle session (mot de passe seul → AAL1) : le défi s'impose, y compris vers /admin directement.
  await context.clearCookies();
  await seConnecter(page, email, motDePasse);
  await page.waitForURL(/\/mfa\/verify/);
  await page.goto("/admin");
  await page.waitForURL(/\/mfa\/verify/);

  // « Cerrar sesión » est une sortie : l'écran de défi n'est plus un cul-de-sac.
  await expect(page.getByTestId("mfa-verify-logout")).toBeVisible();

  await page.locator('input[name="code"]').fill(generateTotp(secret));
  await page.getByTestId("mfa-verify-submit").click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();
});

test("2FA admin : /mfa/enroll offre une sortie et n'enrôle rien tant qu'on n'a pas confirmé", async ({
  page,
}) => {
  const motDePasse = "TwoFaExit1234!";
  const email = await creerAdminDedie("e2e-2fa-exit", motDePasse);

  await seConnecter(page, email, motDePasse);
  await page.waitForURL(/\/admin$/);

  await page.goto("/mfa/enroll");
  await expect(page.getByTestId("mfa-secret")).toBeVisible();
  await expect(page.getByTestId("mfa-copy-secret")).toBeVisible();
  await expect(page.getByTestId("mfa-enroll-logout")).toBeVisible();

  // « Más tarde » : retour à l'app, et le facteur à moitié créé est supprimé (sinon ils
  // s'accumulent jusqu'à max_enrolled_factors).
  await page.getByTestId("mfa-enroll-cancel").click();
  await page.waitForURL(/\/admin$/);
  const facteurs = await withDb(async (client) => {
    const res = await client.query(
      `select count(*)::int as n from auth.mfa_factors f join auth.users u on u.id = f.user_id
        where u.email = $1`,
      [email]
    );
    return res.rows[0].n as number;
  });
  expect(facteurs).toBe(0);

  // Sans facteur vérifié, l'admin reste admin : aucun défi, aucun blocage.
  await page.goto("/admin");
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();
});

test("2FA admin : un second appareil sert de secours — choix au défi, retrait depuis « Seguridad »", async ({
  page,
  context,
}) => {
  // Supabase n'a pas de codes de secours : le secours documenté est un SECOND facteur. La modale le
  // recommande tant qu'il n'y en a qu'un, l'écran de défi laisse choisir l'appareil (un code TOTP
  // est lié au secret de son appareil), et retirer l'un laisse l'autre pleinement fonctionnel.
  const motDePasse = "TwoFaBackup1234!";
  const email = await creerAdminDedie("e2e-2fa-backup", motDePasse);

  await seConnecter(page, email, motDePasse);
  await page.waitForURL(/\/admin$/);

  async function enrolerDepuisLaModale() {
    await page.getByTestId("security-enable").click();
    const secret = await page.getByTestId("mfa-secret").innerText();
    await page.locator('input[name="code"]').fill(generateTotp(secret));
    await page.getByTestId("mfa-enroll-submit").click();
    return secret;
  }

  await page.getByTestId("security-button-nav").click();
  const secretUn = await enrolerDepuisLaModale();
  await expect(page.getByTestId("security-factor")).toHaveCount(1);
  await expect(page.getByTestId("security-backup-hint")).toBeVisible();

  // Second appareil : la recommandation disparaît.
  const secretDeux = await enrolerDepuisLaModale();
  await expect(page.getByTestId("security-factor")).toHaveCount(2);
  await expect(page.getByTestId("security-backup-hint")).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();

  // Nouvelle session : deux appareils → le défi laisse choisir. Le dernier utilisé est proposé en
  // premier (le second), le premier appareil est donc le deuxième bouton.
  await context.clearCookies();
  await seConnecter(page, email, motDePasse);
  await page.waitForURL(/\/mfa\/verify/);
  await expect(page.getByTestId("mfa-verify-factor")).toHaveCount(2);
  await page.getByTestId("mfa-verify-factor").nth(1).click();
  await page.locator('input[name="code"]').fill(generateTotp(secretUn));
  await page.getByTestId("mfa-verify-submit").click();
  await page.waitForURL(/\/admin$/);

  // Retrait du premier appareil (confirmation en deux temps) : il reste le second, qui suffit.
  await page.getByTestId("security-button-nav").click();
  await expect(page.getByTestId("security-factor")).toHaveCount(2);
  await page.getByTestId("security-remove").first().click();
  await page.getByTestId("security-remove-confirm").click();
  await expect(page.getByTestId("security-factor")).toHaveCount(1);
  await expect(page.getByTestId("security-backup-hint")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();

  await context.clearCookies();
  await seConnecter(page, email, motDePasse);
  await page.waitForURL(/\/mfa\/verify/);
  await expect(page.getByTestId("mfa-verify-factor")).toHaveCount(0);
  await page.locator('input[name="code"]').fill(generateTotp(secretDeux));
  await page.getByTestId("mfa-verify-submit").click();
  await page.waitForURL(/\/admin$/);
});

test("2FA admin : une clé de sécurité (WebAuthn) s'ajoute depuis « Seguridad » et passe le défi", async ({
  page,
  context,
}) => {
  // Authentificateur VIRTUEL de Chromium (CDP) : jamais une vraie clé. Il présente la clé et la
  // vérification d'utilisateur tout seul, ce qui rend la cérémonie WebAuthn déterministe en CI.
  const motDePasse = "TwoFaKey1234!";
  const email = await creerAdminDedie("e2e-2fa-key", motDePasse);

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await seConnecter(page, email, motDePasse);
  await page.waitForURL(/\/admin$/);

  // La clé seule suffit à activer le 2FA (pas besoin d'une app d'authentification).
  await page.getByTestId("security-button-nav").click();
  await expect(page.getByTestId("security-status")).toHaveText("No activada");
  await page.getByTestId("security-add-key").click();
  await expect(page.getByTestId("security-status")).toHaveText("Activada");
  await expect(page.getByTestId("security-factor")).toHaveCount(1);
  await expect(page.getByTestId("security-factor")).toContainText("Llave de seguridad 1");
  await expect(page.getByTestId("security-backup-hint")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();

  // Nouvelle session : le défi propose la clé (bouton, pas de champ de code), la présenter suffit.
  await context.clearCookies();
  await seConnecter(page, email, motDePasse);
  await page.waitForURL(/\/mfa\/verify/);
  await expect(page.getByTestId("mfa-verify-use-key")).toBeVisible();
  await expect(page.locator('input[name="code"]')).toHaveCount(0);
  await page.getByTestId("mfa-verify-use-key").click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  // is_admin() exige bien l'AAL2 : la clé l'a atteinte (sinon /admin aurait renvoyé au défi).
  const amr = await withDb(async (client) => {
    const res = await client.query(
      `select s.aal::text as aal from auth.sessions s join auth.users u on u.id = s.user_id
        where u.email = $1 order by s.created_at desc limit 1`,
      [email]
    );
    return res.rows[0].aal as string;
  });
  expect(amr).toBe("aal2");
});
