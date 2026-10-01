import { createTranslator } from "next-intl";
import { loadMessages, type Locale } from "@/messages";

// Remplace `next-intl/server` dans le Storybook (alias Vite, `.storybook/main.ts`). Une page —
// Server Component — rendue dans le navigateur n'a pas de requête Next, donc pas de
// `getRequestConfig` : on reconstruit le traducteur depuis les mêmes fichiers de messages que la
// prod. `setRequestLocale` et `getTranslations` sont les DEUX seuls exports utilisés dans apps/web
// (vérifié le 2026-10-01) — en ajouter un ici s'il en apparaît un.

let localeCourante: Locale = "es";

export function setRequestLocale(locale: string) {
  localeCourante = locale as Locale;
}

export async function getTranslations(arg?: string | { locale?: string; namespace?: string }) {
  const options = typeof arg === "string" ? { namespace: arg } : (arg ?? {});
  const locale = (options.locale ?? localeCourante) as Locale;
  return createTranslator({ locale, messages: loadMessages(locale), namespace: options.namespace as never });
}
