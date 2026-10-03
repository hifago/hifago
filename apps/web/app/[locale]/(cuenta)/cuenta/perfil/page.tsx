import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getMyProfile } from "@/lib/account/getMyProfile";
import { PageShell } from "@/components/atoms/PageShell";
import { LinkButton } from "@/components/atoms/LinkButton";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
import { ProfileForm } from "./ProfileForm";
import { LogoutButton } from "./LogoutButton";
import { DeleteAccountSection } from "./DeleteAccountSection";

// « MI PERFIL » — l'accueil de la zone compte (spec 35 décision ⑧). Le layout (`(cuenta)/layout.tsx`)
// a déjà refusé un invité/visiteur AVANT ce fichier — `getMyProfile()` revérifie quand même
// (`getViewerAccount` en son cœur), même discipline que `/cuenta/reservas` : « jamais par la seule
// garde d'écran ».

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AccountProfilePage");
  // Pas de `robots` ici : la zone entière est déjà `index: false` par son layout.
  return { title: t("metaTitle") };
}

export default async function AccountProfilePage({
  params,
}: PageProps<"/[locale]/cuenta/perfil">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AccountProfilePage");

  const profile = await getMyProfile();
  if (!profile) {
    redirect({ href: "/entrar?next=/cuenta/perfil", locale });
    return;
  }

  // Plan 41, P9 : le bandeau porte le seul `<h1>` et réutilise l'e-mail déjà présent dans le
  // profil comme chapô. Le contenu reste volontairement limité à `max-w-xl` : élargir deux champs
  // simples sur toute la colonne de l'accueil nuirait à leur lecture sans ajouter d'information.
  return (
    <PageShell variant="pagina" testId="mi-perfil-page">
      <BandeauPagina
        variante="contenido"
        titulo={t("title")}
        chapo={profile.email}
        testId="mi-perfil-bandeau"
      />

      <div className="flex max-w-xl flex-col gap-8">
        <section
          data-superficie="clara"
          className="flex flex-col gap-6 rounded-[16px] border border-border bg-surface p-5 sm:p-6"
          data-testid="profile-card"
        >
          <ProfileForm initialFullName={profile.fullName} initialPhone={profile.phone} />

          <div className="flex flex-wrap items-center gap-2" data-testid="profile-secondary-actions">
            <LinkButton href="/cuenta/reservas" variant="solid" color="neutral" width="auto">
              {t("myOrdersCta")}
            </LinkButton>
            <LogoutButton />
          </div>
        </section>

        <DeleteAccountSection
          email={profile.email}
          hasProfessionalCapability={profile.hasProfessionalCapability}
        />
      </div>
    </PageShell>
  );
}
