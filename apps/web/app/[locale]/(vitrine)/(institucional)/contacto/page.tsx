import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { IDENTIDAD_LEGAL } from "@/lib/legal/identidad";
import type { Locale } from "@/messages";
import { metadataInstitucional, PaginaInstitucional } from "../PaginaInstitucional";

// `/[locale]/contacto` — page institutionnelle (spec 27 §2). Texte : `messages/<locale>/Legal.json`,
// clé `contacto`. Seul canal public affiché : l'e-mail (décision Jérôme du 2026-11-12, le WhatsApp
// public a été retiré de cette page).

export async function generateMetadata({ params }: PageProps<"/[locale]/contacto">): Promise<Metadata> {
  const { locale } = await params;
  return metadataInstitucional("contacto", locale as Locale);
}

export default async function ContactoPage({ params }: PageProps<"/[locale]/contacto">) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PaginaInstitucional
      cle="contacto"
      locale={locale as Locale}
      avantSections={
        // `mailto:` : ni lien interne (pas de `Link` localisé), ni nouvel onglet — un `<a>` nu.
        <a
          href={`mailto:${IDENTIDAD_LEGAL.correo}`}
          data-testid="contacto-correo"
          className="inline-flex min-h-11 items-center self-start text-lg font-semibold underline underline-offset-4"
        >
          {IDENTIDAD_LEGAL.correo}
        </a>
      }
    />
  );
}
