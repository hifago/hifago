import { hasLocale } from "next-intl";
import { routing } from "./routing";
import type { Locale } from "@/messages";

/**
 * La locale portée par le premier segment d'un chemin, sinon la locale par défaut — même règle
 * (`hasLocale`) que `[locale]/layout.tsx` et `i18n/request.ts`. Pour les seuls écrans rendus HORS du
 * routage localisé (`app/global-error.tsx`), qui n'ont pas d'autre source de langue que l'URL.
 */
export function localeFromPathname(pathname: string): Locale {
  const premierSegment = pathname.split("/")[1];
  return hasLocale(routing.locales, premierSegment) ? premierSegment : routing.defaultLocale;
}
