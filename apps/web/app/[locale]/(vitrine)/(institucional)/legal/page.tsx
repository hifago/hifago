import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/messages";
import { metadataInstitucional, PaginaInstitucional } from "../PaginaInstitucional";

// `/[locale]/legal` — page institutionnelle (spec 27 §2). Texte : `messages/<locale>/Legal.json`, clé `legal`.

export async function generateMetadata({ params }: PageProps<"/[locale]/legal">): Promise<Metadata> {
  const { locale } = await params;
  return metadataInstitucional("legal", locale as Locale);
}

export default async function AvisoLegalPage({ params }: PageProps<"/[locale]/legal">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PaginaInstitucional cle="legal" locale={locale as Locale} />;
}
