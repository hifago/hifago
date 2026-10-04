import type { StoryObj } from "@storybook/nextjs-vite";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { CartProvider } from "@/lib/cart/CartContext";
import { SiteToaster } from "@/components/organisms/SiteToaster";
import { routing } from "@/i18n/routing";
import VitrineLayout from "@/app/[locale]/(vitrine)/layout";
import TunnelLayout from "@/app/[locale]/(tunnel)/layout";
import AuthLayout from "@/app/[locale]/(auth)/layout";
import CuentaLayout from "@/app/[locale]/(cuenta)/layout";

// Une story d'ÉCRAN = le VRAI `page.tsx`, dans la VRAIE chaîne de layouts, avec des données
// simulées (2026-10-01, pour que Jérôme voie chaque écran dans chaque état avant de trancher le
// design). Rien n'est recopié d'une page : un écran redessiné plus tard est donc à jour ici sans
// toucher à sa story.
//
// Ce qui remplace `[locale]/layout.tsx` (qui rend `<html>`, impossible dans un canevas) :
// `CartProvider` + `SiteToaster`, dans le même ordre ; le `NextIntlClientProvider` est déjà posé
// par le décorateur de langue de `.storybook/preview.tsx`.
//
// ⚠️ La story rendue est AUTONOME (render + beforeEach + parameters sur la story, jamais sur le
// `meta`) : c'est ce qui permet à un parcours de la réutiliser par un simple `{...Historias.X}`.

// `ninguno` : la page rend elle-même sa coquille (`not-found.tsx`) — l'envelopper dans le layout
// vitrine doublerait l'en-tête.
type Grupo = "vitrine" | "tunnel" | "auth" | "cuenta" | "ninguno";

type PropsDeLayout = { children: ReactNode; params: Promise<{ locale: string }> };

const LAYOUTS: Record<Grupo, ComponentType<PropsDeLayout>> = {
  vitrine: VitrineLayout,
  tunnel: TunnelLayout,
  auth: AuthLayout,
  cuenta: CuentaLayout as unknown as ComponentType<PropsDeLayout>,
  ninguno: ({ children }) => <>{children}</>,
};

type OpcionesPagina = {
  // Le type exact de chaque page (`PageProps<"/[locale]/…">`) est plus étroit que ce gabarit
  // générique — d'où ce type large, seul endroit où la frontière est relâchée.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Page: (props: any) => ReactNode | Promise<ReactNode>;
  grupo: Grupo;
  /** Le chemin SANS locale, tel que le voit `usePathname` (fil d'Ariane, sélecteur de langue). */
  ruta: string;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  /** Pose l'état de la story (session, panier, surcharge d'un mock) avant le rendu. */
  preparar?: () => void | (() => void) | Promise<void | (() => void)>;
};

function Pagina({
  Page,
  grupo,
  locale,
  params,
  searchParams,
}: Pick<OpcionesPagina, "Page" | "grupo" | "params" | "searchParams"> & { locale: string }) {
  // Promesses STABLES d'un rendu à l'autre : une page asynchrone qui recevrait une nouvelle
  // promesse à chaque rendu se resuspendrait indéfiniment.
  const promesaParams = useMemo(() => Promise.resolve({ locale, ...params }), [locale, params]);
  const promesaBusqueda = useMemo(() => Promise.resolve(searchParams ?? {}), [searchParams]);
  const Layout = LAYOUTS[grupo];
  return (
    <CartProvider>
      <Layout params={promesaParams}>
        <Page params={promesaParams} searchParams={promesaBusqueda} />
      </Layout>
      <SiteToaster />
    </CartProvider>
  );
}

// ⚠️ Le libellé (`name`) ne se passe PAS ici : l'indexeur de Storybook lit les stories
// statiquement et ne voit pas à l'intérieur d'un appel de fonction. Il s'écrit à côté, en littéral :
//   export const PanierVide: StoryObj = { ...historiaDePagina({ … }), name: "Panier vide" };
export function historiaDePagina({ Page, grupo, ruta, params, searchParams, preparar }: OpcionesPagina): StoryObj {
  return {
    parameters: {
      layout: "fullscreen",
      nextjs: { appDirectory: true, navigation: { pathname: ruta } },
    },
    // Le faux Supabase est déjà remis à zéro par le `beforeEach` du preview, qui passe avant.
    beforeEach: async () => (await preparar?.()) ?? undefined,
    render: (_args, { globals }) => (
      <Pagina
        // La langue de la barre d'outils change la page entière, `key` compris : un changement de
        // locale remonte la page au lieu de garder les promesses de l'ancienne langue.
        key={String(globals.locale)}
        Page={Page}
        grupo={grupo}
        locale={String(globals.locale ?? routing.defaultLocale)}
        params={params}
        searchParams={searchParams}
      />
    ),
  };
}
