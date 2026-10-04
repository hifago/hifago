"use client";

import { useSyncExternalStore } from "react";
import { NextIntlClientProvider } from "next-intl";
import { ErrorScreen } from "@/components/organisms/ErrorScreen";
import { localeFromPathname } from "@/i18n/localeFromPathname";
import { routing } from "@/i18n/routing";
import commonEs from "@/messages/es/Common.json";
import commonEn from "@/messages/en/Common.json";
import type { Locale } from "@/messages";
import "./globals.css";

// LA DERNIÈRE FRONTIÈRE : elle REMPLACE le layout racine `[locale]/layout.tsx` quand c'est lui qui
// échoue (sa lecture de l'URL du site, ses polices, le CartProvider). Plus rien de ce layout n'est
// là — ni `<html lang>`, ni NextIntlClientProvider, ni coquille —, d'où ce qui suit :
//
// - Elle pose son propre `<html>`/`<body>` (Next l'exige) et le thème `vitrine` ; la feuille de
//   style est réimportée ici, Next ne l'injecte pas pour cet écran. Pas de polices `next/font` : la
//   pile système suffit à un écran d'erreur, et c'est une dépendance de moins qui pourrait échouer.
// - La langue ne peut venir que de l'URL (`localeFromPathname`, même règle que le layout).
//   `useSyncExternalStore` : la locale par défaut au rendu serveur, celle de l'URL dès l'hydratation,
//   sans écart signalé entre les deux.
// - Les messages sont le SEUL namespace `Common`, importé statiquement : `loadMessages` tirerait les
//   ~36 fichiers de messages dans le bundle d'un écran qui n'en lit que quatre clés. La parité es/en
//   reste garantie par `messages/parity.test.ts`.
// - Le lien d'accueil est complet (`/es`, `/en`) et provoque un rechargement : hors du routage
//   localisé, le `Link` de `@/i18n/navigation` n'a rien sur quoi s'appuyer, et après une panne du
//   layout racine, repartir d'un document neuf est précisément ce qu'on veut.

const COMMON: Record<Locale, typeof commonEs> = { es: commonEs, en: commonEn };

function sAbonner() {
  return () => {};
}

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const locale = useSyncExternalStore(
    sAbonner,
    () => localeFromPathname(window.location.pathname),
    () => routing.defaultLocale
  );

  return (
    <html lang={locale} data-theme="vitrine" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={{ Common: COMMON[locale] }}>
          <ErrorScreen
            error={error}
            retry={retry}
            zone="global"
            testId="global-error"
            inicioHref={`/${locale}`}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
