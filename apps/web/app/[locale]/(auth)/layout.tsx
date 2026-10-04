import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Zone AUTH — connexion, inscription, vérification, mot de passe (spec 27 §0). Jamais indexée.
//
// `follow: true` volontaire : la page ne doit pas être indexée, mais ses liens (retour à l'accueil,
// bascule connexion/inscription) doivent rester suivis. `Disallow` et `noindex` ne se cumulent
// jamais sur une même page — `.claude/rules/seo.md` point 5.

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HomePage" });

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-2">
      {/* Seul écran sans la coquille du site : le panneau porte à lui seul la marque (D12 = A).
          Le lien nomme le logo, dont l'image est décorative. */}
      <header
        data-superficie="or"
        className="relative flex min-h-48 overflow-hidden bg-accent px-5 pb-10 pt-5 text-foreground lg:min-h-dvh lg:items-start lg:justify-center lg:px-10 lg:py-16"
      >
        <div className="relative z-10 flex w-full max-w-lg flex-col items-center text-center lg:items-start lg:text-left">
          <Link href="/" aria-label="Hifago" className="inline-flex min-h-11 items-center">
            <Image
              src="/brand/logo-portada.webp"
              alt=""
              aria-hidden
              loading="eager"
              width={900}
              height={483}
              sizes="(min-width: 1024px) 260px, 152px"
              className="h-auto w-38 lg:w-65"
            />
          </Link>
          <p className="mt-2 whitespace-pre-line font-sans text-lg font-extrabold leading-[1.11] tracking-[-0.04em] lg:mt-8 lg:text-[2.5rem]">
            {t("h1")}
          </p>
        </div>
        <Image
          src="/brand/calle-zocalos-auth.webp"
          alt=""
          aria-hidden
          loading="lazy"
          width={900}
          height={600}
          sizes="(min-width: 1024px) 50vw, 0px"
          className="pointer-events-none absolute bottom-0 right-0 hidden h-auto w-full select-none [mask-image:linear-gradient(to_bottom,transparent,black_18%)] lg:block"
        />
      </header>
      <div className="bg-background">{children}</div>
    </div>
  );
}
