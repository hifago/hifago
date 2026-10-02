import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getViewerAccount } from "@/lib/auth/viewer";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { Title } from "@/components/atoms/Title";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/restablecer-password">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "ResetPassword" });
  return { title: t("title"), robots: { index: false, follow: true } };
}

// Atteint uniquement via /auth/callback?type=recovery, qui a déjà établi une session de
// récupération (verifyOtp) avant de rediriger ici — même contrat qu'apps/admin/app/
// reset-password/page.tsx. Sans session (arrivée directe sur cette URL, lien déjà consommé ou
// expiré), rien à réinitialiser.
//
// ⚠️ jamais `createClient()` directement ici (scripts/check-data-layer.sh interdit tout client
// Supabase dans un fichier de route d'apps/web) — `getViewerAccount()` (@/lib/auth/viewer) fait ce
// même `getUser()` côté serveur pour le compte de cette page. Une session de récupération est une
// session réelle comme une autre, jamais anonyme.
export default async function ResetPasswordPage({
  params,
}: PageProps<"/[locale]/restablecer-password">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("ResetPassword");
  const account = await getViewerAccount();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <Title as="h1">{t("title")}</Title>
      {account ? (
        <ResetPasswordForm />
      ) : (
        <p
          className="max-w-sm text-center text-sm text-danger"
          data-testid="reset-password-no-session"
        >
          {t("noSession")}{" "}
          <Link href="/olvide-password" className="underline">
            {t("noSessionLink")}
          </Link>
          .
        </p>
      )}
    </main>
  );
}
