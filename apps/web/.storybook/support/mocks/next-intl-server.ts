import { createTranslator } from "next-intl";
import { loadMessages, type Locale } from "@/messages";

// Remplace `next-intl/server` dans le Storybook (alias Vite, `.storybook/main.ts`). Une page —
// Server Component — rendue dans le navigateur n'a pas de requête Next, donc pas de
// `getRequestConfig` : on reconstruit le traducteur depuis les mêmes fichiers de messages que la
// prod. Le mock expose les trois lectures utilisées par les Server Components de la vitrine.

let localeCourante: Locale = "es";

export function setRequestLocale(locale: string) {
  localeCourante = locale as Locale;
}

export async function getLocale() {
  return localeCourante;
}

export async function getTranslations(arg?: string | { locale?: string; namespace?: string }) {
  const options = typeof arg === "string" ? { namespace: arg } : (arg ?? {});
  const locale = (options.locale ?? localeCourante) as Locale;
  return createTranslator({ locale, messages: loadMessages(locale), namespace: options.namespace as never });
}
