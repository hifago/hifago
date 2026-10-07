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
    // Port 3100, pas 3000 : le 3000 local est occupé en permanence par un conteneur Docker
    // d'un autre projet sur cette machine (décision Jérôme, 2026-08-13) — cf. package.json
    // (`next dev -p 3100`) et supabase/config.toml (site_url/additional_redirect_urls alignés).
    baseURL: "http://localhost:3100",
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
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
  },
});
