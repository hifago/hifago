import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Anton, Geist_Mono, Poppins } from "next/font/google";
import { routing } from "@/i18n/routing";
import { SiteToaster } from "@/components/organisms/SiteToaster";
import { CartProvider } from "@/lib/cart/CartContext";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import "../globals.css";

// Les polices de la charte graphique Hifago 2026 (PDF fourni par Jérôme le 2026-10-01).
//
// ⚠️ Les noms de variables comptent, et c'est le piège qui a laissé cette vitrine en pile système
// pendant des mois : `next/font` produisait `--font-geist-sans`, alors que HeroUI et Tailwind
// consomment `--font-sans` / `--font-mono`. Les deux noms ne se rejoignaient NULLE PART, donc
// aucune des deux polices chargées n'était jamais appliquée (diagnostic posé par la story
// `Playground/Palette`). Le raccord se fait maintenant dans `packages/ui/src/styles/globals.css`,
// sur le sélecteur du thème : `--font-sans: var(--font-poppins), …`.
//
// ⚠️ DEUX DES QUATRE POLICES DE LA CHARTE MANQUENT, et ce n'est pas un oubli :
//   - **Garet** (le logo) n'est sur aucun service de polices Google. Elle n'est PAS nécessaire ici :
//     le logo est servi en image (`/brand/logo-*.png`), donc son dessin est déjà celui de Garet.
//   - **Sugo Display** (les titres) n'y est pas non plus, et seule sa version d'essai existe. Les
//     titres sont en **Anton**, qui est elle-même dans la charte (sous-titres) et tient le même
//     registre — condensée, très grasse, bâton. **Confirmée par Jérôme le 2026-10-02** (arbitrage D5
//     de `docs/specs/41-charte-hifago-toute-la-vitrine.md`) : Sugo ne sera pas licenciée.
// `800` : le titre du héros de l'accueil (`PortadaInicio`), composé en Poppins ExtraBold sur la
// maquette du 2026-10-02 — sans cette graisse, le navigateur rendrait la 700 sans prévenir.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// Hors charte, et volontairement conservée : la charte ne prévoit aucune monospace, mais les codes
// partenaires et les montants tabulaires en demandent une. Aucun impact sur l'identité.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(
  props: Omit<LayoutProps<"/[locale]">, "children">,
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "LocaleLayout" });
  return {
    // Sans metadataBase, TOUT `alternates.canonical` / `openGraph.url` relatif du site reste
    // relatif (next/dist/lib/metadata/default-metadata.js pose `metadataBase: null`, et
    // resolve-url.js ne résout en absolu que s'il est renseigné). Les canonicals des fiches
    // produit/établissement existaient déjà et étaient donc inertes. Posé ici parce que ce
    // layout est le root layout de fait — apps/web n'a pas de app/layout.tsx.
    metadataBase: new URL(getSiteUrl()),
    title: t("title"),
  };
}

export default async function PublicLocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      data-theme="vitrine"
      className={`${poppins.variable} ${anton.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <NextIntlClientProvider>
          <CartProvider>{children}</CartProvider>
          {/* ⚠️ Monté nulle part jusqu'ici (spec 28 Tranche 3, 2026-09-13) — `SiteToaster.tsx`
              documentait déjà ce manque depuis le 2026-09-02 : sans lui, AUCUN toast de cet écran
              n'était visible, `toast.danger` de `useAddToCart` compris. Frère de `{children}`,
              jamais une enveloppe (cf. l'avertissement de `SiteToaster.tsx`). */}
          <SiteToaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
