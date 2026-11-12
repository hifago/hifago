import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/messages";
import { metadataInstitucional, PaginaInstitucional } from "../PaginaInstitucional";

// `/[locale]/terminos` — page institutionnelle (spec 27 §2). Texte : `messages/<locale>/Legal.json`, clé `terminos`.

export async function generateMetadata({ params }: PageProps<"/[locale]/terminos">): Promise<Metadata> {
  const { locale } = await params;
  return metadataInstitucional("terminos", locale as Locale);
}

export default async function TerminosPage({ params }: PageProps<"/[locale]/terminos">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PaginaInstitucional cle="terminos" locale={locale as Locale} />;
}
