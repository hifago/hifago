import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { CartProvider, useCart, type AddToCartInput } from "@/lib/cart/CartContext";
import { loadMessages, type Locale } from "@/messages";
import { SiteHeader } from "./SiteHeader";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Depuis spec 31 (Tranche 1), addLine est async et appelle getSession() avant d'ajouter une ligne
// (cf. lib/cart/CartContext.tsx). Mocké ici avec une session DÉJÀ active : ce fichier vérifie le
// rendu du panier, pas le mécanisme d'identité (déjà couvert par CartContext.test.tsx) — sans ce
// mock, addLine tenterait un vrai appel réseau (@supabase/ssr lève faute d'URL/clé en test).
//
// Depuis spec 32 (panier en base) : addLine écrit réellement dans cart_items (RLS directe) —
// `from("cart_items")` simule cette table en mémoire, dans l'ordre d'insertion.
type Row = {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  slot_start_time: string | null;
  qty: number;
};
let cartRows: Row[] = [];

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "test-user" } } } }) },
    from: (table: string) => {
      if (table !== "cart_items") throw new Error(`table inattendue dans ce mock : ${table}`);
      return {
        insert: (row: { product_id: string; date: string; end_date: string | null; slot_start_time: string | null; qty: number }) => {
          cartRows.push({ id: `row-${cartRows.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        },
        select: () => ({
          order: () => Promise.resolve({ data: cartRows, error: null }),
        }),
      };
    },
  }),
}));
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
//
// ⚠️ `@/i18n/navigation` tire next-intl/navigation → next/navigation, dont la résolution casse sous
// Vitest. Le même mock vit dans les autres tests qui rendent un lien — il vivait dans
// `CatalogBrowser.test.tsx` et `ProductDetailView.test.tsx`, tous deux disparus le 2026-09-08
// (specs 28 et 30) ; `FichaProducto.test.tsx` en est l'héritier. `Link` reçoit ici
// une prop `locale` en plus : le mock la rend en préfixe, exactement comme le vrai — sans quoi le
// test du sélecteur de langue ne vérifierait rien de ce qui compte.
const pushMock = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, children, ...props }: React.ComponentProps<"a"> & { locale?: string }) => (
    <a href={locale ? `/${locale}${href}` : String(href)} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/productos/kayak",
  useRouter: () => ({ push: pushMock }),
}));

const messages = loadMessages("es");

function Entoure({
  children,
  locale = "es",
  lignes = [],
}: {
  children: React.ReactNode;
  locale?: Locale;
  lignes?: AddToCartInput[];
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <CartProvider>
        <RemplitLePanier lignes={lignes} />
        {children}
      </CartProvider>
    </NextIntlClientProvider>
  );
}

/** Remplit le panier au montage : `CartProvider` n'accepte pas d'état initial. */
function RemplitLePanier({ lignes }: { lignes: AddToCartInput[] }) {
  const { lines, addLine } = useCart();
  if (lines.length === 0 && lignes.length > 0) {
    for (const ligne of lignes) addLine(ligne);
  }
  return null;
}

const ligne = (id: string): AddToCartInput => ({
  productId: `p-${id}`,
  date: "2026-09-14",
  qty: 3,
});

// Async depuis spec 31 : addLine traverse getSession() avant d'ajouter une ligne — même une
// session mockée déjà active franchit une micro-tâche réelle. Depuis spec 32 (panier en base),
// addLine écrit réellement dans cart_items puis appelle refresh() : la chaîne est désormais
// getSession → insert → refresh (getSession → select.order) → setLines, quatre micro-tâches
// enchaînées au lieu d'une seule. Les six `await Promise.resolve()` ci-dessous flushent large
// (marge au-dessus des quatre nécessaires) avant que le container ne soit rendu à l'appelant —
// suffisant même pour les N appels concurrents de `RemplitLePanier` (aucun n'est chaîné à un
// autre, donc N ne rallonge pas la profondeur, seulement la largeur de chaque palier).
async function rendu(
  props: { isAuthenticated?: boolean; lignes?: AddToCartInput[]; locale?: Locale; transparente?: boolean } = {}
) {
  // Chaque appel isole son propre panier : sans ce reset, les lignes ajoutées par un test
  // précédent (table en mémoire du mock, cf. tête de fichier) fausseraient le compte du suivant.
  cartRows = [];
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <Entoure locale={props.locale} lignes={props.lignes}>
        <SiteHeader
          isAuthenticated={props.isAuthenticated ?? false}
          transparente={props.transparente}
          testId="header"
        />
      </Entoure>
    ));
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
    }
  });
  return container;
}

describe("SiteHeader", () => {
  // ⚠️ `pushMock` est un mock de MODULE, partagé par tous les tests ; `window.history.pushState`
  // modifie l'état réel de jsdom, qui persiste sinon d'un test à l'autre du même fichier.
  beforeEach(() => {
    pushMock.mockClear();
  });
  afterEach(() => {
    window.history.pushState({}, "", "/");
    // La variante transparente lit `scrollY` : un test qui fait défiler ne doit pas laisser la page
    // défilée au suivant.
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("introduit les landmarks que l'app n'avait pas", async () => {
    const container = await rendu();
    const header = container.querySelector("header") as HTMLElement;
    expect(header).not.toBeNull();
    // Deux `<nav>` VOISINS et nommés : les langues, puis la navigation (Mi viaje, compte). Jamais
    // l'un dans l'autre — deux landmarks imbriqués s'annoncent mal.
    const navs = Array.from(header.querySelectorAll("nav"));
    expect(navs.map((nav) => nav.getAttribute("aria-label"))).toEqual([
      messages.Chrome.languageLabel,
      messages.Chrome.navLabel,
    ]);
    expect(navs[0].contains(navs[1]) || navs[1].contains(navs[0])).toBe(false);
    // ⚠️ Le logo n'est PAS un <h1> : le titre appartient à la page, pas à la marque.
    expect(header.querySelector("h1")).toBeNull();
  });

  // Plan 41, item C1 (arbitrage D2 = A) : UN header, l'or de l'accueil, sur toutes les pages.
  it("pose le header or sur toutes les pages : collant, sans bordure basse", async () => {
    const header = (await rendu()).querySelector("header") as HTMLElement;
    expect(header.getAttribute("data-superficie")).toBe("or");
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("bg-accent");
    expect(header.className).not.toMatch(/\bborder-b\b/);
  });

  // La déclinaison SANS or (asset A1) : le « GO » or des deux autres disparaîtrait sur l'or. Une
  // seule image, pas les deux basculées par le mode.
  it("porte le logo sur or, et lui seul", async () => {
    const logo = (await rendu()).querySelector('[data-testid="header-home"]') as HTMLElement;
    const images = Array.from(logo.querySelectorAll("img"));
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toContain("logo-header-sur-or");
  });

  it("prend son ombre une fois la page défilée, et la rend en remontant", async () => {
    const header = (await rendu()).querySelector("header") as HTMLElement;
    expect(header.hasAttribute("data-defile")).toBe(false);
    expect(header.className).not.toContain("shadow-");

    await act(async () => {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 120 });
      window.dispatchEvent(new Event("scroll"));
    });
    expect(header.hasAttribute("data-defile")).toBe(true);
    expect(header.className).toContain("shadow-");
    // L'or ne dépend pas du défilement, hors de l'accueil.
    expect(header.className).toContain("bg-accent");

    await act(async () => {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
      window.dispatchEvent(new Event("scroll"));
    });
    expect(header.hasAttribute("data-defile")).toBe(false);
    expect(header.className).not.toContain("shadow-");
  });

  it("fait du logo un lien vers l'accueil, nommé", async () => {
    const container = await rendu();
    const logo = container.querySelector('[data-testid="header-home"]') as HTMLAnchorElement;
    expect(logo.tagName).toBe("A");
    expect(logo.getAttribute("href")).toBe("/");
    expect(logo.getAttribute("aria-label")).toBe(messages.Chrome.homeLabel);
  });

  // Bug Jérôme du 2026-09-16 : cliquer le logo effaçait les filtres actifs. `href="/"` reste
  // statique dans le DOM (test précédent) ; c'est l'`onClick` qui lit `window.location.search` en
  // direct et navigue avec, via `router.push`.
  it("conserve la query string active en cliquant le logo", async () => {
    window.history.pushState({}, "", "/es/actividades?q=kayak");
    const container = await rendu();
    const logo = container.querySelector('[data-testid="header-home"]') as HTMLAnchorElement;
    fireEvent.click(logo);
    expect(pushMock).toHaveBeenCalledWith("/?q=kayak");
  });

  describe("le panier", () => {
    // ⚠️ Ce que la pastille compte : les LIGNES, pas la somme des `qty` (décision de Jérôme).
    // Chaque ligne du panier de test porte `qty: 3` : si un jour quelqu'un « corrige » en sommant
    // les quantités, ce test tombe avec 9 au lieu de 3.
    it("compte les lignes sélectionnées, jamais la somme des quantités", async () => {
      const container = await rendu({ lignes: [ligne("a"), ligne("b"), ligne("c")] });
      const pastille = container.querySelector('[data-slot="badge-label"], .badge__label') as HTMLElement;
      expect(pastille.textContent).toBe("3");
    });

    // ⚠️ Marine, chiffre blanc (plan 41, C1) : une pastille or posée sur l'or n'avait plus de forme.
    // jsdom ne calcule pas les couleurs : on vérifie qu'elle lit les jetons du bouton marine.
    it("pose une pastille marine, qui se détache sur l'or", async () => {
      const container = await rendu({ lignes: [ligne("a")] });
      const pastille = container.querySelector(".badge") as HTMLElement;
      expect(pastille.className).toContain("[--badge-bg:var(--bouton-marine)]");
      expect(pastille.className).toContain("[--badge-fg:var(--bouton-marine-texte)]");
    });

    // Demande de Jérôme (2026-10-02) : un bouton bien visible, l'icône ET le texte. Le libellé est
    // vérifié VISIBLE — hors du `sr-only` qui porte le compte.
    it("affiche « Mi viaje en Guatapé » en toutes lettres, dans un bouton", async () => {
      const panier = (await rendu()).querySelector('[data-testid="header-cart"]') as HTMLElement;
      const visible = Array.from(panier.childNodes)
        .filter((noeud) => !(noeud instanceof HTMLElement && noeud.classList.contains("sr-only")))
        .map((noeud) => noeud.textContent)
        .join("");
      expect(visible).toBe("Mi viaje en Guatapé");
      expect(panier.querySelector("svg")).not.toBeNull();
      // Pas d'`aria-label` : il écraserait le texte visible (WCAG 2.5.3).
      expect(panier.hasAttribute("aria-label")).toBe(false);
    });

    // Vue mobile (Jérôme, 2026-10-02) : « Mi viaje » seul sous `md`. jsdom n'applique pas Tailwind :
    // ce qui est vérifié, c'est que « en Guatapé », et lui seul, porte la classe qui le masque.
    it("réserve « en Guatapé » aux écrans `md` et plus", async () => {
      const panier = (await rendu()).querySelector('[data-testid="header-cart"]') as HTMLElement;
      const lieu = panier.querySelector(".hidden.md\\:inline") as HTMLElement;
      expect(lieu.textContent).toBe(" en Guatapé");
    });

    // ⚠️ Un nombre affiché ne suffit pas à un lecteur d'écran : « 3 » dans une pastille peut
    // s'annoncer n'importe comment. Le compte est donc DANS le nom accessible, au pluriel de la
    // langue (ICU de next-intl), jamais concaténé.
    it("annonce le compte en toutes lettres, avec le bon pluriel", async () => {
      const vide = (await rendu()).querySelector('[data-testid="header-cart"]') as HTMLElement;
      expect(vide.textContent).toBe("Mi viaje en Guatapé, vacío");

      const un = (await rendu({ lignes: [ligne("a")] })).querySelector(
        '[data-testid="header-cart"]'
      ) as HTMLElement;
      expect(un.textContent).toBe("Mi viaje en Guatapé, 1 servicio");

      const deux = (await rendu({ lignes: [ligne("a"), ligne("b")] })).querySelector(
        '[data-testid="header-cart"]'
      ) as HTMLElement;
      expect(deux.textContent).toBe("Mi viaje en Guatapé, 2 servicios");
    });

    it("n'affiche aucune pastille quand le panier est vide", async () => {
      const container = await rendu();
      expect(container.querySelector(".badge__label")).toBeNull();
    });

    it("plafonne l'affichage à 99+ sans mentir sur le nom accessible", async () => {
      const cent = Array.from({ length: 100 }, (_, i) => ligne(String(i)));
      const container = await rendu({ lignes: cent });
      expect((container.querySelector(".badge__label") as HTMLElement).textContent).toBe("99+");
      expect((container.querySelector('[data-testid="header-cart"]') as HTMLElement).textContent).toBe(
        "Mi viaje en Guatapé, 100 servicios"
      );
    });

    // Un lien, pas un bouton : le panier s'ouvre au clic du milieu, se copie, se met en favori.
    it("est un LIEN vers la page du panier", async () => {
      const panier = (await rendu()).querySelector('[data-testid="header-cart"]') as HTMLAnchorElement;
      expect(panier.tagName).toBe("A");
      expect(panier.getAttribute("href")).toBe("/mi-viaje");
    });
  });

  describe("le compte", () => {
    it("mène à la connexion quand le visiteur est déconnecté", async () => {
      const lien = (await rendu({ isAuthenticated: false })).querySelector(
        '[data-testid="header-account"]'
      ) as HTMLAnchorElement;
      expect(lien.getAttribute("href")).toBe("/entrar");
      expect(lien.getAttribute("aria-label")).toBe(messages.Chrome.loginLabel);
    });

    it("mène à la page du compte quand il est connecté", async () => {
      const lien = (await rendu({ isAuthenticated: true })).querySelector(
        '[data-testid="header-account"]'
      ) as HTMLAnchorElement;
      expect(lien.getAttribute("href")).toBe("/cuenta/perfil");
      expect(lien.getAttribute("aria-label")).toBe(messages.Chrome.accountLabel);
    });
  });

  // Plus de menu burger depuis le plan 41 (C1) : tout est en ligne, à toutes les largeurs.
  describe("sans menu à déplier", () => {
    it("n'a aucun bouton de menu, à aucune largeur", async () => {
      const header = (await rendu()).querySelector("header") as HTMLElement;
      expect(header.querySelector("button[aria-expanded]")).toBeNull();
      expect(header.querySelector('[data-testid="header-menu-toggle"]')).toBeNull();
    });

    // ⚠️ LE test du header. Google indexe la version MOBILE : les liens `/en/…` du sélecteur de
    // langue — ce qui fait découvrir la version anglaise — doivent être dans le HTML SERVI, pas
    // seulement dans le DOM après hydratation. Ils l'étaient dans un panneau replié ; ils le sont
    // désormais en ligne. On vérifie le HTML serveur : c'est celui que Googlebot reçoit.
    it("laisse les liens de langue et de compte dans le HTML SERVI", () => {
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale="es" messages={messages}>
          <CartProvider>
            <SiteHeader isAuthenticated={false} testId="header" />
          </CartProvider>
        </NextIntlClientProvider>
      );
      // ⚠️ Portée exacte : le préfixe vient du mock ci-dessus, pas du vrai `Link`. Ce que le test
      // prouve, c'est que les liens sont RENDUS dès le serveur, pas la forme de l'URL.
      expect(html).toContain('href="/es/productos/kayak"');
      expect(html).toContain('href="/en/productos/kayak"');
      expect(html).toContain('href="/entrar"');
      expect(html).toContain('href="/mi-viaje"');
    });
  });

  it("traduit tout ce qu'il affiche, dans les deux langues", async () => {
    const en = await rendu({ locale: "en", lignes: [ligne("a")] });
    expect((en.querySelector('[data-testid="header-cart"]') as HTMLElement).textContent).toBe(
      "My trip in Guatapé, 1 item"
    );
    expect((en.querySelector('[data-testid="header-home"]') as HTMLElement).getAttribute("aria-label")).toBe(
      "Hifago, go to home"
    );
  });

  // ⚠️ L'hydratation : le panier vit côté client. Si `CartProvider` lisait un stockage local, le
  // serveur rendrait un compte et le client un autre — pastille qui clignote, ou erreur en console.
  // Vérifié plutôt que supposé : il s'initialise à `[]` sans aucune persistance (son en-tête le
  // documente), donc les deux rendus partent du même état.
  it("rend côté serveur exactement ce que le client rend au premier passage", async () => {
    const serveur = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={messages}>
        <CartProvider>
          <SiteHeader isAuthenticated={false} testId="header" />
        </CartProvider>
      </NextIntlClientProvider>
    );
    const client = await rendu();
    const panierServeur = new DOMParser()
      .parseFromString(serveur, "text/html")
      .querySelector('[data-testid="header-cart"]')?.textContent;
    const panierClient = (client.querySelector('[data-testid="header-cart"]') as HTMLElement).textContent;
    expect(panierServeur).toBe(panierClient);
    expect(panierServeur).toBe("Mi viaje en Guatapé, vacío");
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // LA VARIANTE TRANSPARENTE — l'accueil de la maquette de Jérôme (2026-10-01)
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe("variante transparente (l'accueil)", () => {
    async function defiler(jusqua: number) {
      await act(async () => {
        Object.defineProperty(window, "scrollY", { configurable: true, value: jusqua });
        window.dispatchEvent(new Event("scroll"));
      });
    }

    // La demande de Jérôme, mot pour mot : « que le header soit transparent et comporte bien
    // l'accès à mi viaje ainsi que mon compte ». Les deux liens sont vérifiés PAR LEUR CIBLE, pas
    // seulement par leur présence : un lien de compte qui mènerait au panier passerait sinon.
    it("porte Mi viaje, Mi cuenta et les deux langues en ligne — sans logo ni bouton de menu", async () => {
      const container = await rendu({ transparente: true });
      const header = container.querySelector("header") as HTMLElement;

      expect(header.querySelector('[data-testid="header-cart"]')?.getAttribute("href")).toBe("/mi-viaje");
      const compte = header.querySelector('[data-testid="header-account"]') as HTMLAnchorElement;
      expect(compte.getAttribute("href")).toBe("/entrar");
      expect(compte.getAttribute("aria-label")).toBe(messages.Chrome.loginLabel);

      // Les langues : deux vrais liens, posés dans le header, sans panneau à ouvrir.
      expect(header.querySelector('[data-testid="header-language-es"]')?.getAttribute("href")).toBe(
        "/es/productos/kayak"
      );
      expect(header.querySelector('[data-testid="header-language-en"]')?.getAttribute("href")).toBe(
        "/en/productos/kayak"
      );

      // Le grand logo du héros tient le rôle du logo : pas de second logo dans le header. Et rien
      // à replier : aucun bouton de menu, à aucune largeur.
      expect(header.querySelector('[data-testid="header-home"]')).toBeNull();
      expect(header.querySelector("button[aria-expanded]")).toBeNull();
    });

    it("mène à « Mi cuenta » une fois connecté", async () => {
      const container = await rendu({ transparente: true, isAuthenticated: true });
      const compte = container.querySelector('[data-testid="header-account"]') as HTMLAnchorElement;
      expect(compte.getAttribute("href")).toBe("/cuenta/perfil");
      expect(compte.getAttribute("aria-label")).toBe(messages.Chrome.accountLabel);
    });

    // ⚠️ Transparent ET collant, le header ferait défiler les sections SOUS ses icônes, sans rien
    // entre les deux. Il ne l'est donc qu'en haut de page — et le redevient en y revenant.
    it("est transparent en haut de page, prend l'or une fois défilé, et le rend en remontant", async () => {
      const container = await rendu({ transparente: true });
      const header = container.querySelector("header") as HTMLElement;
      expect(header.className).toContain("bg-transparent");
      expect(header.hasAttribute("data-defile")).toBe(false);

      await defiler(120);
      expect(header.className).toContain("bg-accent");
      expect(header.className).not.toContain("bg-transparent");
      expect(header.hasAttribute("data-defile")).toBe(true);

      await defiler(0);
      expect(header.className).toContain("bg-transparent");
      expect(header.hasAttribute("data-defile")).toBe(false);
    });

    // Le HTML SERVI est celui du haut de page : transparent, et avec ses liens. Même raison que le
    // test du menu plus haut — c'est ce HTML que Googlebot reçoit, et les liens `/en/…` y font
    // découvrir la version anglaise.
    it("sert le haut de page : transparent, langues et compte dans le HTML", () => {
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale="es" messages={messages}>
          <CartProvider>
            <SiteHeader isAuthenticated={false} transparente testId="header" />
          </CartProvider>
        </NextIntlClientProvider>
      );
      expect(html).toContain("bg-transparent");
      // Posé sur l'or, défilé ou non : il en porte la surface (plan 41, F3) — c'est elle qui passe
      // son contour et son focus au marine. Déclarée sur le header lui-même, jamais sur le <body>.
      expect(html).toContain('data-superficie="or"');
      expect(html).toContain('href="/es/productos/kayak"');
      expect(html).toContain('href="/en/productos/kayak"');
      expect(html).toContain('href="/entrar"');
      expect(html).toContain('href="/mi-viaje"');
    });

    it("garde la pastille du panier, avec le compte exact dans le nom accessible", async () => {
      const container = await rendu({ transparente: true, lignes: [ligne("a"), ligne("b")] });
      const panier = container.querySelector('[data-testid="header-cart"]') as HTMLElement;
      expect(panier.textContent).toBe("Mi viaje en Guatapé, 2 servicios");
      expect(container.querySelector("header")?.textContent).toContain("2");
      // Marine sur l'accueil aussi : c'est là, sur le bouton en contour mobile, qu'elle disparaissait.
      expect((container.querySelector(".badge") as HTMLElement).className).toContain(
        "[--badge-bg:var(--bouton-marine)]"
      );
    });
  });
});
