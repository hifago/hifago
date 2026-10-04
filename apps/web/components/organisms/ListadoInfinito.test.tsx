import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";
import { ListadoInfinito } from "./ListadoInfinito";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// ⚠️ Le catalogue de messages est le VRAI (`loadMessages`), jamais un objet écrit à la main :
// la revue du 2026-09-08 a montré qu'un catalogue de test teste le catalogue de test — renommer
// une variable ICU dans `messages/` laissait tout vert pendant que l'écran affichait la clé brute.
//
// Ce que ce fichier protège, et qui ne se voit sur AUCUN rendu correct :
//   • le bouton reste le chemin garanti (clavier, lecteur d'écran) même sans IntersectionObserver ;
//   • une panne du pont ne se lit pas « il n'y a plus rien » ;
//   • l'URL suit en `replaceState`, jamais en `pushState` ;
//   • la liste se resynchronise quand la requête change sous elle.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Embla (le carrousel de PhotoStrip, monté par chaque TarjetaOferta) appelle au montage trois API
// que jsdom n'implémente pas. Mêmes bouchons que TarjetaOferta.test.tsx.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MESSAGES = loadMessages("es");

function oferta(slug: string): OfertaTarjeta {
  return {
    clave: `producto-${slug}`,
    href: `/productos/${slug}`,
    nombre: `Oferta ${slug}`,
    establecimiento: "Casa Kayam",
    precio: { tipo: "monto", cop: 90000 },
    fotos: [],
    tipo: "activity",
    capacidad: null,
    nAlojamientos: null,
    testId: `tarjeta-${slug}`,
  };
}

function rendre(props: Partial<React.ComponentProps<typeof ListadoInfinito>> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={MESSAGES}>
      <ListadoInfinito
        tarjetasIniciales={[oferta("a"), oferta("b")]}
        total={5}
        hayMasInicial
        paginaInicial={1}
        endpointBase="/api/catalogo/listado?tipo=activity&locale=es"
        locale="es"
        {...props}
      />
    </NextIntlClientProvider>
  );
}

describe("ListadoInfinito", () => {
  it("rend les cartes reçues du serveur, sans rien demander au montage", () => {
    const appels = vi.fn();
    vi.stubGlobal("fetch", appels);
    const { container } = rendre();

    expect(container.querySelectorAll("li").length).toBe(2);
    // ⚠️ LE point de la première page : c'est le serveur qui l'a rendue. Un `fetch` au montage
    // voudrait dire que la liste ne s'affiche pas sans JavaScript — donc qu'un crawler ne la voit
    // pas, et que le LCP attend le réseau.
    expect(appels).not.toHaveBeenCalled();
  });

  // ⚠️ LE test d'accessibilité de ce composant. `IntersectionObserver` n'existe pas dans jsdom :
  // ce rendu est donc exactement la situation d'un visiteur au clavier ou au lecteur d'écran, qui
  // ne déclenche jamais l'observateur. Le bouton doit être là — c'est son seul chemin.
  it("rend le bouton « Cargar más » même sans IntersectionObserver", () => {
    const { container } = rendre();
    const bouton = container.querySelector('[data-testid="listado-cargar-mas"]');
    expect(bouton).not.toBeNull();
    expect(bouton?.textContent).toContain("Cargar más");
  });

  it("ne rend pas le bouton quand tout est déjà affiché", () => {
    const { container } = rendre({ hayMasInicial: false, total: 2 });
    expect(container.querySelector('[data-testid="listado-cargar-mas"]')).toBeNull();
  });

  // ⚠️ La région doit exister AVANT d'avoir quelque chose à dire : un `role="status"` monté au
  // moment du changement n'est jamais annoncé. C'est invisible à l'œil et au typecheck — le piège
  // déjà commis puis corrigé sur l'accueil (spec 28 §10quater).
  it("rend la région d'état en permanence, dès le premier rendu", () => {
    const region = rendre().container.querySelector('[data-testid="listado-estado"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toContain("2 de 5");
  });

  it("ajoute la page suivante, met à jour le décompte et l'adresse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tarjetas: [oferta("c")], hayMas: false }),
      })
    );
    const replace = vi.fn();
    vi.stubGlobal("history", { ...window.history, replaceState: replace });

    const { container } = rendre();
    const bouton = container.querySelector('[data-testid="listado-cargar-mas"]') as HTMLElement;
    await act(async () => bouton.click());

    await waitFor(() => expect(container.querySelectorAll("li").length).toBe(3));
    expect(container.querySelector('[data-testid="listado-estado"]')?.textContent).toContain(
      "3 de 5"
    );

    // ⚠️ `replaceState`, jamais `pushState` : chaque page empilerait sinon une entrée d'historique,
    // et « précédent » ferait remonter la liste tranche par tranche au lieu de ramener le visiteur
    // d'où il vient.
    expect(replace).toHaveBeenCalledTimes(1);
    expect(String(replace.mock.calls[0][2])).toContain("pagina=2");
  });

  // ⚠️ Le trou trouvé le 2026-09-08 sur le pont des suggestions, refermé ici d'avance : sans le
  // `if (!reponse.ok) throw`, une réponse d'erreur (qui ne porte PAS de clé `tarjetas`) partirait
  // en TypeError au rendu suivant — donc sur l'écran d'erreur, pour une panne rattrapable.
  it("garde la liste et le dit quand le pont échoue — jamais « il n'y a plus rien »", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = rendre();
    const bouton = container.querySelector('[data-testid="listado-cargar-mas"]') as HTMLElement;
    await act(async () => bouton.click());

    await waitFor(() =>
      expect(container.querySelector('[data-testid="listado-estado"]')?.textContent).toContain(
        "No pudimos cargar más ofertas"
      )
    );
    // L'échec dans l'encadré d'erreur de la charte (plan 41, P2), DANS la région d'état — celle-ci
    // n'a pas été remontée, elle est toujours `status`.
    const region = container.querySelector('[data-testid="listado-estado"]');
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.querySelector('[data-tono="error"]')).not.toBeNull();
    // La liste garde ce qu'elle affichait, et le bouton reste actionnable pour réessayer.
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelector('[data-testid="listado-cargar-mas"]')?.textContent).toContain(
      "Reintentar"
    );
  });

  // ⚠️ Même piège que `BuscadorInicio` : React conserve l'état d'un composant monté. Sans la
  // resynchronisation, revenir en arrière vers une autre catégorie afficherait les offres de la
  // précédente, et le décompte mentirait avec elles.
  it("se resynchronise quand la requête change sous lui", () => {
    const { container, rerender } = rendre();
    expect(container.querySelectorAll("li").length).toBe(2);

    rerender(
      <NextIntlClientProvider locale="es" messages={MESSAGES}>
        <ListadoInfinito
          tarjetasIniciales={[oferta("z")]}
          total={1}
          hayMasInicial={false}
          paginaInicial={1}
          endpointBase="/api/catalogo/listado?tipo=camp&locale=es"
          locale="es"
        />
      </NextIntlClientProvider>
    );

    expect(container.querySelectorAll("li").length).toBe(1);
    expect(container.querySelector('[data-testid="listado-estado"]')?.textContent).toContain(
      "1 de 1"
    );
  });
});
