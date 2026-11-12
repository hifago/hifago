// Messages d'interface, UN FICHIER PAR NAMESPACE ET PAR LOCALE.
//
// ⚠️ Pourquoi éclaté plutôt qu'un `es.json` unique (2026-09-01) : plusieurs agents créent des
// composants EN PARALLÈLE dans le même répertoire de travail. Il n'y a donc aucun merge git pour
// arbitrer — deux agents qui écrivent dans le même fichier de messages s'écrasent en direct, sans
// que rien ne le signale. Un fichier par namespace supprime la course : chacun n'écrit que dans le
// sien.
//
// Les imports ci-dessous sont STATIQUES à dessein : `import.meta.glob` ne fonctionne que sous Vite
// (donc Storybook), et une lecture du système de fichiers ne fonctionne pas côté client ni en test.
// Seuls des imports statiques marchent dans les trois environnements — Next (serveur), Vitest et
// Vite. Ce fichier n'est modifié qu'à l'ajout d'un NAMESPACE (rare : un par écran), jamais à
// l'ajout d'une clé — c'est ce qui le rend acceptable comme point de passage partagé.
import esChrome from "./es/Chrome.json";
import esLocaleLayout from "./es/LocaleLayout.json";
import esHomePage from "./es/HomePage.json";
import esListadoPage from "./es/ListadoPage.json";
import esNotFound from "./es/NotFound.json";
import esLogin from "./es/Login.json";
import esSignup from "./es/Signup.json";
import esVerifyEmail from "./es/VerifyEmail.json";
import esForgotPassword from "./es/ForgotPassword.json";
import esResetPassword from "./es/ResetPassword.json";
import esCommon from "./es/Common.json";
import esProductPage from "./es/ProductPage.json";
import esEstablishmentPage from "./es/EstablishmentPage.json";
import esCheckoutPage from "./es/CheckoutPage.json";
import esAccountOrdersPage from "./es/AccountOrdersPage.json";
import esAccountProfilePage from "./es/AccountProfilePage.json";
import esCartPage from "./es/CartPage.json";
import esOrderResultPage from "./es/OrderResultPage.json";
import esLegal from "./es/Legal.json";
import enChrome from "./en/Chrome.json";
import enLocaleLayout from "./en/LocaleLayout.json";
import enHomePage from "./en/HomePage.json";
import enListadoPage from "./en/ListadoPage.json";
import enNotFound from "./en/NotFound.json";
import enLogin from "./en/Login.json";
import enSignup from "./en/Signup.json";
import enVerifyEmail from "./en/VerifyEmail.json";
import enForgotPassword from "./en/ForgotPassword.json";
import enResetPassword from "./en/ResetPassword.json";
import enCommon from "./en/Common.json";
import enProductPage from "./en/ProductPage.json";
import enEstablishmentPage from "./en/EstablishmentPage.json";
import enCheckoutPage from "./en/CheckoutPage.json";
import enAccountOrdersPage from "./en/AccountOrdersPage.json";
import enAccountProfilePage from "./en/AccountProfilePage.json";
import enCartPage from "./en/CartPage.json";
import enOrderResultPage from "./en/OrderResultPage.json";
import enLegal from "./en/Legal.json";

import type { routing } from "@/i18n/routing";

/** Locale d'interface routée. Exportée pour que personne n'ait à re-dériver la même chaîne. */
export type Locale = (typeof routing)["locales"][number];

const MESSAGES = {
  es: {
    // Coquille du site (header, et footer à venir) — namespace ajouté le 2026-09-02, vague 4.
    Chrome: esChrome,
    LocaleLayout: esLocaleLayout,
    HomePage: esHomePage,
    ListadoPage: esListadoPage,
    NotFound: esNotFound,
    Login: esLogin,
    Signup: esSignup,
    VerifyEmail: esVerifyEmail,
    ForgotPassword: esForgotPassword,
    ResetPassword: esResetPassword,
    Common: esCommon,
    ProductPage: esProductPage,
    EstablishmentPage: esEstablishmentPage,
    CheckoutPage: esCheckoutPage,
    AccountOrdersPage: esAccountOrdersPage,
    AccountProfilePage: esAccountProfilePage,
    CartPage: esCartPage,
    OrderResultPage: esOrderResultPage,
    // Pages institutionnelles (aviso legal, condiciones, privacidad, ayuda, contacto) — 2026-11-05.
    Legal: esLegal,
  },
  en: {
    Chrome: enChrome,
    LocaleLayout: enLocaleLayout,
    HomePage: enHomePage,
    ListadoPage: enListadoPage,
    NotFound: enNotFound,
    Login: enLogin,
    Signup: enSignup,
    VerifyEmail: enVerifyEmail,
    ForgotPassword: enForgotPassword,
    ResetPassword: enResetPassword,
    Common: enCommon,
    ProductPage: enProductPage,
    EstablishmentPage: enEstablishmentPage,
    CheckoutPage: enCheckoutPage,
    AccountOrdersPage: enAccountOrdersPage,
    AccountProfilePage: enAccountProfilePage,
    CartPage: enCartPage,
    OrderResultPage: enOrderResultPage,
    Legal: enLegal,
  },
} as const;

/** Messages complets d'une locale. Utilisé par i18n/request.ts, les tests et le playground. */
export function loadMessages(locale: Locale) {
  return MESSAGES[locale];
}

