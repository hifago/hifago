import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/messages";
import { metadataInstitucional, PaginaInstitucional } from "../PaginaInstitucional";

// `/[locale]/privacidad` — page institutionnelle (spec 27 §2). Texte : `messages/<locale>/Legal.json`, clé `privacidad`.

export async function generateMetadata({ params }: PageProps<"/[locale]/privacidad">): Promise<Metadata> {
  const { locale } = await params;
  return metadataInstitucional("privacidad", locale as Locale);
}

export default async function PrivacidadPage({ params }: PageProps<"/[locale]/privacidad">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PaginaInstitucional cle="privacidad" locale={locale as Locale} />;
}
