import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { Title } from "@/components/atoms/Title";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/olvide-password">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "ForgotPassword" });
  // ⚠️ noindex plutôt qu'un Disallow (même raisonnement que verificar-email/page.tsx, spec 26 §5.1).
  return { title: t("title"), robots: { index: false, follow: true } };
}

// Adapté d'apps/admin/app/forgot-password/page.tsx (encore vivant côté admin, même besoin ici) —
// localisé pour apps/web. Message générique systématique côté formulaire, jamais de confirmation
// ou d'infirmation de l'existence d'un compte.
export default async function ForgotPasswordPage({
  params,
}: PageProps<"/[locale]/olvide-password">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("ForgotPassword");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <Title as="h1">{t("title")}</Title>
      <ForgotPasswordForm />
    </main>
  );
}
