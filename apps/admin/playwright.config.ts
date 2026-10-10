import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // ⚠️ NETTOYAGE DE FIN DE SUITE (2026-09-08). Les specs créent de vrais produits,
  // établissements et catégories, et ne les supprimaient pas : 78 résidus contre 7 lignes de
  // seed en base locale, mesuré le 2026-09-08. Ce n'est pas cosmétique — les sections de
  // l'accueil et des listings plafonnent à 8 offres en `created_at desc`, donc les résidus
  // poussent les offres SEEDÉES hors de l'écran et font échouer des tests sur des sélecteurs
  // pourtant justes (`home.spec.ts`, `reserve.spec.ts`). Un teardown GLOBAL plutôt qu'un
  // `afterAll` par fichier : un nettoyage réparti s'oublie au spec suivant.
  globalSetup: "../../packages/e2e-support/src/globalSetup.ts",
  globalTeardown: "../../packages/e2e-support/src/cleanup.ts",
  fullyParallel: true,
  reporter: "html",
  use: {
    // Port 3101 (apps/admin) — cf. package.json (`next dev -p 3101`) et supabase/config.toml
    // (additional_redirect_urls aligné le 2026-08-14 lors de la scission monorepo web/admin).
    baseURL: "http://localhost:3101",
    // Lot fuseau (2026-08-28). Le navigateur des tests est à GUATAPÉ, comme les visiteurs et les
    // socios réels. Sans ce réglage, les calendriers client (react-day-picker, SVAR) prennent le
    // fuseau de la machine du runner — America/Bogota sur la machine de dev, UTC en CI — et la
    // suite mesure alors la machine plutôt que l'application. C'est cette divergence-là qui a
    // rendu les dix sites du fuseau invisibles pendant des mois.
    //
    // ⚠️ Ne couvre QUE le navigateur. Le processus Node du runner (les helpers de
    // packages/e2e-support) et le serveur Next gardent leur propre fuseau : eux passent par
    // todayInBogota(), et les deux gestes sont nécessaires.
    timezoneId: "America/Bogota",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Deux serveurs : plusieurs specs (offboarding, publish/dépublish, disponibilité socio, lien
  // de parrainage...) vérifient l'effet d'une action admin/socio sur la fiche publique, qui vit
  // désormais dans apps/web (port 3100) — un autre process, depuis la scission monorepo web/admin
  // du 2026-08-14. Sans ce second webServer, ces specs échouent en ERR_CONNECTION_REFUSED.
  webServer: [
    {
      command: "npm run dev",
      // "/" existe (app/page.tsx, dispatcher par type d'utilisateur) mais exige une session et
      // redirige donc vers /login pour un visiteur anonyme — pointer la vérification de
      // disponibilité du serveur directement sur /login, qui répond toujours 200 sans dépendre
      // d'un aller-retour Supabase.
      url: "http://localhost:3101/login",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev --workspace=apps/web",
      cwd: "../..",
      url: "http://localhost:3100/es",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
