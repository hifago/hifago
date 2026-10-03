import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getViewerAccount } from "@/lib/auth/viewer";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { AuthPage } from "../_components/AuthPage";
import { Aviso } from "@/components/molecules/Aviso";

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
    <AuthPage title={t("title")}>
      {account ? (
        <ResetPasswordForm />
      ) : (
        <Aviso tono="error" rol="alert" testId="reset-password-no-session">
          <p>
            {t("noSession")}{" "}
            <Link href="/olvide-password" className="underline">
              {t("noSessionLink")}
            </Link>
            .
          </p>
        </Aviso>
      )}
    </AuthPage>
  );
}
