import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/messages";
import { metadataInstitucional, PaginaInstitucional } from "../PaginaInstitucional";

// `/[locale]/ayuda` — page institutionnelle (spec 27 §2). Texte : `messages/<locale>/Legal.json`, clé `ayuda`.

export async function generateMetadata({ params }: PageProps<"/[locale]/ayuda">): Promise<Metadata> {
  const { locale } = await params;
  return metadataInstitucional("ayuda", locale as Locale);
}

export default async function AyudaPage({ params }: PageProps<"/[locale]/ayuda">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PaginaInstitucional cle="ayuda" locale={locale as Locale} />;
}
