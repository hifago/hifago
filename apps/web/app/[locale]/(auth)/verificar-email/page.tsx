import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ResendConfirmationForm } from "./ResendConfirmationForm";
import { AuthPage } from "../_components/AuthPage";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/verificar-email">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "VerifyEmail" });
  // ⚠️ noindex plutôt qu'un Disallow dans robots.txt, et la distinction n'est pas cosmétique :
  // une page en Disallow n'est jamais CHARGÉE, donc sa balise noindex n'est jamais lue, et elle
  // peut finir indexée sans description si un lien externe la désigne. Disallow sert à économiser
  // du budget de crawl, noindex à empêcher l'indexation — jamais les deux sur la même page
  // (spec 26 §5.1).
  return { title: t("title"), robots: { index: false, follow: true } };
}

// Atterrissage après un signUp() sans session (confirmation requise) — même besoin que l'écran
// homologue d'apps/admin (encore vivant), adapté et localisé pour apps/web. `email` optionnel :
// arrivée directe sans contexte affiche un message générique plutôt que de planter.
export default async function VerifyEmailPage({
  params,
  searchParams,
}: PageProps<"/[locale]/verificar-email">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("VerifyEmail");

  const resolvedSearchParams = await searchParams;
  const emailParam = resolvedSearchParams?.email;
  const email = typeof emailParam === "string" ? emailParam : null;

  return (
    <AuthPage title={t("title")}>
      <p className="text-center text-base text-muted">
        {email ? t("bodyWithEmail", { email }) : t("bodyGeneric")}
      </p>
      <ResendConfirmationForm email={email} />
    </AuthPage>
  );
}
