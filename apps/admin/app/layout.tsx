import type { Metadata, Viewport } from "next";
import { Anton, Geist_Mono, Poppins } from "next/font/google";
import { Toast } from "@hifago/ui";
import "./globals.css";

// Les polices de la charte Hifago 2026, les mêmes que la vitrine (apps/web/app/[locale]/layout.tsx).
// ⚠️ Les noms de variables comptent : HeroUI et Tailwind lisent `--font-sans`, pas le nom que pose
// `next/font`. Le raccord se fait dans `packages/ui/src/styles/globals.css`, sur le thème admin
// (`--font-sans: var(--font-poppins), …`) — sans lui la police est chargée et jamais appliquée,
// ce qui était le cas de Geist ici jusqu'au 2026-10-13 (l'admin rendait en pile système).
// Quatre graisses seulement : l'admin n'emploie ni la 300 ni la 800 de la vitrine.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Anton : le titre de page seul (classe `titre-page`), jamais sous 20 px, jamais en gras.
const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// Hors charte, conservée : codes partenaires, identifiants de tâches, montants tabulaires.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hifago",
};

// viewport-fit=cover : sans lui, env(safe-area-inset-*) (déjà utilisé par le Toast ci-dessous et
// par la nouvelle barre de nav mobile sticky) n'a aucun inset non nul à lire sur iOS à encoche —
// Next pose son propre défaut sans ce flag tant qu'aucun export `viewport` n'existe.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      data-theme="admin"
      className={`${poppins.variable} ${anton.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col bg-background text-foreground"
        suppressHydrationWarning
      >
        {children}
        {/* Seul point de montage du toast (succès/échec) de toute l'app admin+socio+auth — un
            popup remplace le message inline partout, jamais les deux (décision Jérôme,
            docs/specs/16-notifications-toast.md). SIBLING de {children}, jamais un wrapper autour :
            le `children` de Toast.Provider est un render-prop pour personnaliser CHAQUE carte de
            toast (rendu par UNSTABLE_ToastRegion), pas un slot pour le contenu de l'app — lui
            passer {children} de la page fait retourner `null` à la région tant qu'aucun toast
            n'existe (visibleToasts.length === 0), ce qui masque toute l'app (bug constaté en
            testant réellement dans un navigateur, invisible au typecheck/build). placement="bottom"
            = défaut HeroUI, explicité pour documenter l'intention plutôt que la laisser implicite. */}
        <Toast.Provider placement="bottom" />
      </body>
    </html>
  );
}
