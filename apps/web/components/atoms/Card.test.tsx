import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Card } from "./Card";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même mock que BackLink.test.tsx : `@/i18n/navigation` tire next-intl/navigation →
// next/navigation, dont la résolution casse sous Vitest. `data-localized` prouve que le lien de la
// carte cliquable est bien le Link localisé et pas un `<a>` nu — sans quoi le préfixe de locale
// serait perdu et la carte renverrait un hispanophone sur une page en anglais.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

const TITRE = "Habitación privada con vista al lago";
const DESCRIPTION = "Amplia habitación con balcón privado sobre el embalse, para dos personas.";

function carte(element: React.ReactElement) {
  const { container } = render(element);
  return container.firstElementChild as HTMLElement;
}

describe("Card", () => {
  it("rend le titre au niveau demandé, la description et le contenu", () => {
    const el = carte(
      <Card title={TITRE} titleAs="h2" description={DESCRIPTION} testId="produit">
        <p>Corps</p>
      </Card>
    );
    const titre = el.querySelector("h2") as HTMLElement;
    expect(titre.textContent).toBe(TITRE);
    expect(el.querySelector("[data-slot='card-description']")?.textContent).toBe(DESCRIPTION);
    expect(el.querySelector("[data-slot='card-content']")?.textContent).toBe("Corps");
    expect(el.getAttribute("data-testid")).toBe("produit");
  });

  // ⚠️ HeroUI rend un <h3> d'office. Une carte de catalogue qui suit le <h1> de la page produirait
  // donc un saut de niveau, invisible à l'œil et signalé par les audits SEO. Le niveau est une
  // décision de la page — même règle, même mécanisme que l'atome `Title`.
  it("laisse la page choisir le niveau du titre, et ne le devine jamais", () => {
    for (const niveau of ["h2", "h3", "h4"] as const) {
      const el = carte(
        <Card title="T" titleAs={niveau}>
          <p>x</p>
        </Card>
      );
      expect(el.querySelector(niveau)).not.toBeNull();
      // Le titre garde le style de HeroUI : on change la balise, pas l'apparence.
      expect(el.querySelector(niveau)?.className).toContain("card__title");
    }
  });

  it("dissocie la taille du titre de son niveau", () => {
    const petit = carte(<Card title="T" titleAs="h2"><p>x</p></Card>);
    const moyen = carte(<Card title="T" titleAs="h2" titleSize="md"><p>x</p></Card>);
    const grand = carte(<Card title="T" titleAs="h2" titleSize="lg"><p>x</p></Card>);
    // `sm` = le `.card__title` de HeroUI, sans ajout de taille — `line-clamp-1` reste posé dans
    // les trois tailles (hauteur de carte fixe, cf. son propre test dédié plus bas).
    expect(petit.querySelector("h2")?.className.trim()).toBe("card__title line-clamp-1");
    expect(moyen.querySelector("h2")?.className).toContain("text-lg");
    expect(grand.querySelector("h2")?.className).toContain("text-2xl");
  });

  // Plan 41, F2 : le titre d'une carte de CONTENU prend le rôle `titre-bloc` de la charte, qui porte
  // police, taille et graisse 400 — aucune classe de taille ni de graisse Tailwind à côté.
  it("`titleSize=\"bloque\"` pose le rôle `titre-bloc`, sans taille ni graisse Tailwind", () => {
    const bloc = carte(<Card title="T" titleAs="h2" titleSize="bloque"><p>x</p></Card>);
    const classes = bloc.querySelector("h2")?.className ?? "";
    expect(classes).toContain("titre-bloc");
    expect(classes).not.toMatch(/\b(text-(xs|sm|base|lg|xl|2xl)|font-(medium|semibold|bold))\b/);
  });

  it("centre le titre (et l'en-tête qui le contient) seulement quand `titleAlign` le demande", () => {
    const parDefaut = carte(<Card title="T" titleAs="h2"><p>x</p></Card>);
    const centre = carte(<Card title="T" titleAs="h2" titleAlign="center"><p>x</p></Card>);
    expect(parDefaut.querySelector("[data-slot='card-header']")?.className).not.toContain("text-center");
    expect(centre.querySelector("[data-slot='card-header']")?.className).toContain("text-center");
  });

  it("`fullHeight` étire la carte à `h-full` et centre son contenu, sans y toucher par défaut", () => {
    const parDefaut = carte(<Card title="T" titleAs="h2"><p>x</p></Card>);
    const etiree = carte(<Card title="T" titleAs="h2" fullHeight><p>x</p></Card>);
    expect(parDefaut.className).not.toContain("h-full");
    expect(etiree.className).toContain("h-full");
    expect(etiree.className).toContain("justify-center");
  });

  it("n'ouvre l'écart du contenu que quand on le demande", () => {
    const parDefaut = carte(<Card title="T" titleAs="h2"><p>x</p></Card>);
    const aere = carte(<Card title="T" titleAs="h2" contentGap="lg"><p>x</p></Card>);
    // `.card__content` porte déjà `gap-1` : le défaut n'ajoute rien.
    expect(parDefaut.querySelector("[data-slot='card-content']")?.className.trim()).toBe("card__content");
    expect(aere.querySelector("[data-slot='card-content']")?.className).toContain("gap-6");
  });

  // Plan 41, F6 : les cartes de contenu prennent 20 → 24 px. Le défaut ne pose aucune classe, et
  // c'est ce qui garde les tuiles et les fiches au `p-4` de HeroUI.
  it("n'élargit le padding que quand on le demande, et jamais sur la carte overlay", () => {
    const parDefaut = carte(<Card title="T" titleAs="h2"><p>x</p></Card>);
    const ample = carte(<Card title="T" titleAs="h2" padding="lg"><p>x</p></Card>);
    const overlay = carte(
      <Card title="T" titleAs="h2" layout="overlay" padding="lg" media={<div />}><p>x</p></Card>
    );
    expect(parDefaut.className).not.toMatch(/\bp-[56]\b/);
    expect(ample.className).toContain("p-5");
    expect(ample.className).toContain("sm:p-6");
    expect(overlay.className).toContain("p-0");
    expect(overlay.className).not.toContain("p-5");
  });

  it("ne rend ni en-tête ni contenu quand il n'y a rien à y mettre", () => {
    const el = carte(<Card testId="vide" />);
    expect(el.querySelector("[data-slot='card-header']")).toBeNull();
    expect(el.querySelector("[data-slot='card-content']")).toBeNull();
    expect(el.children.length).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ LA CARTE CLIQUABLE — ce que le composant existe pour corriger
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("annonce le TITRE SEUL comme nom du lien, et pas toute la carte", () => {
    // `getByRole(name)` passe par le calcul de nom accessible de @testing-library/dom — c'est ce
    // qu'un lecteur d'écran annonce, pas une approximation sur le textContent.
    const { getByRole, queryByRole } = render(
      <Card href="/productos/habitacion" title={TITRE} titleAs="h2" subtitle="2 habitaciones" description={DESCRIPTION}>
        <p>Desde 180.000 COP</p>
      </Card>
    );
    expect(getByRole("link", { name: TITRE })).not.toBeNull();
    // Et le nom N'EST PAS la concaténation : la description, le sous-titre et le prix sont dans la
    // carte, jamais dans le libellé du lien.
    expect(queryByRole("link", { name: new RegExp(DESCRIPTION) })).toBeNull();
    expect(queryByRole("link", { name: /2 habitaciones/ })).toBeNull();
    expect(queryByRole("link", { name: /180\.000/ })).toBeNull();
  });

  // Le témoin du défaut corrigé : le motif actuel (CatalogBrowser.tsx:94) enveloppe la carte
  // entière. Rendu ici tel quel, il montre ce que le lecteur d'écran annonce aujourd'hui — et
  // pourquoi le test ci-dessus est un gain, pas une préférence.
  it("le motif d'origine, lui, produit un libellé qui contient toute la carte", () => {
    const { getByRole } = render(
      // `#temoin` et non un vrai chemin : ce lien n'est là que pour mesurer un nom accessible, et
      // un chemin de page ferait crier @next/next/no-html-link-for-pages — à raison.
      <a href="#temoin">
        <Card title={TITRE} titleAs="h2" description={DESCRIPTION}>
          <p>Desde 180.000 COP</p>
        </Card>
      </a>
    );
    const nom = getByRole("link").textContent ?? "";
    expect(nom).toContain(TITRE);
    expect(nom).toContain(DESCRIPTION);
    expect(nom).toContain("180.000");
  });

  it("garde un VRAI lien : <a href>, localisé, pas un gestionnaire de clic sur la carte", () => {
    const el = carte(
      <Card href="/productos/habitacion" title={TITRE} titleAs="h2" testId="produit">
        <p>x</p>
      </Card>
    );
    // La carte elle-même n'est pas le lien — c'est ce qui permet d'y remettre un élément interactif.
    expect(el.tagName).toBe("DIV");
    const liens = el.querySelectorAll("a");
    expect(liens.length).toBe(1);
    expect(liens[0].getAttribute("href")).toBe("/productos/habitacion");
    expect(liens[0].getAttribute("data-localized")).toBe("true");
    expect(liens[0].getAttribute("data-testid")).toBe("produit-link");
    // Le lien vit DANS le titre : c'est lui qui donne son nom au lien.
    expect(liens[0].parentElement?.getAttribute("data-slot")).toBe("card-title");
  });

  // ⚠️ Sans l'overlay, seuls les quelques mots du titre seraient cliquables : la carte cesserait
  // d'être une cible tactile. C'est la moitié du motif que rien d'autre ne vérifie.
  it("étire la zone cliquable sur toute la carte, au-dessus du visuel", () => {
    const el = carte(
      <Card href="/p/x" title="T" titleAs="h2" media={<div data-testid="photo" />}>
        <p>x</p>
      </Card>
    );
    const classes = (el.querySelector("a") as HTMLElement).className;
    expect(classes).toContain("after:absolute");
    expect(classes).toContain("after:inset-0");
    // Le visuel d'`Image` rend un conteneur `relative` : sans z-index, l'overlay passerait dessous
    // et la photo — la plus grande surface de la carte — ne serait pas cliquable.
    expect(classes).toContain("after:z-[1]");
    // Tailwind v4 pose `content: ''` par défaut sur `after:`, mais un pseudo-élément sans contenu
    // n'est pas généré : la classe est écrite explicitement, et ce test la retient.
    expect(classes).toContain("after:content-['']");
  });

  it("laisse la place à un second élément interactif, hors du lien", () => {
    const el = carte(
      <Card href="/p/x" title="T" titleAs="h2">
        <button type="button" data-testid="ajouter">
          Añadir
        </button>
      </Card>
    );
    const lien = el.querySelector("a") as HTMLElement;
    const bouton = el.querySelector("[data-testid='ajouter']") as HTMLElement;
    expect(bouton).not.toBeNull();
    // ⚠️ Le point entier du motif : le bouton est un FRÈRE du lien, pas un descendant. Un <button>
    // dans un <a> est du HTML invalide que les navigateurs réparent en cassant le lien.
    expect(lien.contains(bouton)).toBe(false);
  });

  // ⚠️ Le corollaire, et c'est une panne SILENCIEUSE si on l'oublie : l'overlay est en `z-[1]`, donc
  // un enfant interactif laissé en `z-index: auto` passe DESSOUS et son clic part au lien de la
  // carte. Mesuré dans le navigateur le 2026-09-02 : sur une carte cliquable, `elementFromPoint`
  // au centre d'un `<button>` sans z-index renvoie le `<a>`, et le clic est reçu par le lien ; les
  // mêmes enfants dans une carte NON cliquable reçoivent leur clic normalement.
  //
  // La carte remonte donc ses enfants interactifs elle-même : l'appelant n'a aucune classe à
  // penser. Ce test retient le mécanisme — les deux classes ET l'exclusion du lien du titre, qui
  // porte l'overlay et n'a pas à passer au-dessus de son propre pseudo-élément.
  it("remonte elle-même les enfants interactifs au-dessus de l'overlay", () => {
    const cliquable = carte(
      <Card href="/p/x" title="T" titleAs="h2">
        <button type="button">Añadir</button>
      </Card>
    );
    const cible = ":is(button,select,input,textarea,[role=button],a:not([data-card-link]))";
    // ⚠️ `:not(.absolute)` sur la moitié `relative` seulement (2026-09-02, vague 4) : un enfant déjà
    // en `absolute` est déjà positionné, `z-index` s'y applique, et lui imposer `relative` le
    // replacerait dans le flux — les flèches du carrousel de `molecules/PhotoStrip` atterrissaient
    // sous la photo. La moitié `z-[2]`, elle, reste inconditionnelle : c'est elle qui remonte.
    expect(cliquable.className).toContain(`[&_${cible}:not(.absolute)]:relative`);
    expect(cliquable.className).toContain(`[&_${cible}]:z-[2]`);

    // Une carte non cliquable n'a pas d'overlay : rien à remonter, et poser un z-index sur ses
    // enfants créerait des empilements sans raison.
    const statique = carte(
      <Card title="T" titleAs="h2">
        <button type="button">Añadir</button>
      </Card>
    );
    expect(statique.className).not.toContain("z-[2]");
  });

  it("porte une affordance de survol et un anneau de focus sur la carte cliquable", () => {
    const cliquable = carte(<Card href="/p/x" title="T" titleAs="h2"><p>x</p></Card>);
    const statique = carte(<Card title="T" titleAs="h2"><p>x</p></Card>);
    // ⚠️ Un `ring`, pas un `border-color` : `.card` ne déclare aucune bordure, donc le
    // `hover:border-accent` écrit aujourd'hui sur EstablishmentDetailView.tsx:140 ne peint rien.
    expect(cliquable.className).toContain("hover:ring-2");
    expect(cliquable.className).toContain("hover:ring-accent");
    // Le focus clavier atterrit sur le lien du titre : l'anneau doit entourer la carte entière,
    // sinon il désigne trois mots au milieu d'une surface cliquable de 300 px.
    expect(cliquable.className).toContain("has-[[data-card-link]:focus-visible]:status-focused");
    // Une carte non cliquable ne réagit ni au survol ni au focus.
    expect(statique.className).not.toContain("hover:ring-2");
  });

  // Les trois directives ci-dessous échouent au `tsc --noEmit` si la garantie disparaît du type —
  // un test de rendu ne verrait ni l'une ni l'autre.
  it("exige un titre lisible dès que la carte est cliquable, et un niveau dès qu'il y a un titre", () => {
    const rejets = (
      <>
        {/* @ts-expect-error `title` est requis quand `href` est fourni : c'est le nom du lien. */}
        <Card href="/p/x" />
        {/* @ts-expect-error et il doit être une chaîne, jamais du JSX. */}
        <Card href="/p/x" title={<em>T</em>} titleAs="h2" />
        {/* @ts-expect-error `titleAs` est requis dès qu'il y a un titre. */}
        <Card title="T" />
      </>
    );
    expect(rejets).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Le visuel
  // ─────────────────────────────────────────────────────────────────────────────────────────

  // ⚠️ `overflow-hidden` était INERTE dans le code d'origine (CatalogBrowser.tsx:95) : `.card`
  // porte `p-4`, donc l'image était déjà en retrait de 16 px des bords et il n'y avait rien à
  // rogner. Ici le visuel annule ce padding — et la classe se met à servir.
  it("met le visuel à fleur de carte, et rogne alors vraiment les angles", () => {
    const el = carte(
      <Card title="T" titleAs="h2" media={<div data-testid="photo" />} testId="produit">
        <p>x</p>
      </Card>
    );
    const enveloppe = el.querySelector("[data-testid='produit-media']") as HTMLElement;
    expect(enveloppe.className).toContain("-mx-4");
    expect(enveloppe.className).toContain("-mt-4");
    expect(el.className).toContain("overflow-hidden");
    expect(enveloppe.querySelector("[data-testid='photo']")).not.toBeNull();
  });

  // Sans ce suivi, un visuel dans une carte `padding="lg"` resterait en retrait de 4 à 8 px.
  it("garde le visuel à fleur de carte quand le padding s'élargit", () => {
    const el = carte(
      <Card title="T" titleAs="h2" padding="lg" media={<div />} testId="ample">
        <p>x</p>
      </Card>
    );
    const enveloppe = el.querySelector("[data-testid='ample-media']") as HTMLElement;
    expect(enveloppe.className).toContain("-mx-5");
    expect(enveloppe.className).toContain("sm:-mt-6");
    expect(enveloppe.className).not.toContain("-mx-4");
  });

  it("ne rogne pas une carte sans visuel : l'overflow-visible de HeroUI est laissé en place", () => {
    expect(carte(<Card title="T" titleAs="h2"><p>x</p></Card>).className).not.toContain("overflow-hidden");
  });

  it("en ligne, le visuel devient une vignette et le texte peut rétrécir", () => {
    const el = carte(
      <Card layout="row" title="T" titleAs="h3" media={<div />} testId="produit">
        <p>x</p>
      </Card>
    );
    expect(el.className).toContain("flex-row");
    expect(el.className).toContain("items-center");
    expect((el.querySelector("[data-testid='produit-media']") as HTMLElement).className).toContain("w-16");
    // ⚠️ `min-w-0` : sans lui un enfant flex refuse de descendre sous la largeur de son contenu, et
    // un titre long pousse la vignette hors de la carte.
    expect((el.querySelector(".flex.min-w-0") as HTMLElement)).not.toBeNull();
    // Pas de rognage sur la carte : la vignette rogne la sienne.
    expect(el.className).not.toContain("overflow-hidden");
  });

  // ⚠️ La disposition des cartes carrées de l'accueil (2026-10-01). Le défaut à craindre est
  // SILENCIEUX : un cartouche positionné (`absolute`) capturerait le `::after` du lien, et un clic
  // sur la photo ne mènerait plus nulle part — jsdom ne le verrait pas, seule la structure le peut.
  it("en overlay, la carte est carrée et le texte se pose sur le visuel sans capturer le lien", () => {
    const el = carte(
      <Card layout="overlay" href="/x" title="Kayak" titleAs="h3" subtitle="Casa" media={<div />} testId="o">
        <span>20.000 COP</span>
      </Card>
    );
    expect(el.className).toContain("aspect-square");
    expect(el.className).toContain("overflow-hidden");
    expect(el.className).toContain("grid-rows-[minmax(0,1fr)]");
    const media = el.querySelector("[data-testid='o-media']") as HTMLElement;
    expect(media.className).toContain("row-start-1");
    // Le cartouche partage la cellule du visuel, et AUCUN ancêtre du lien entre lui et la carte
    // n'est positionné : le `::after` couvre donc toute la carte, photo comprise.
    const lien = el.querySelector("[data-card-link]") as HTMLElement;
    let noeud = lien.parentElement;
    while (noeud && noeud !== el) {
      expect(noeud.className).not.toMatch(/(^|\s)(absolute|relative|fixed|sticky)(\s|$)/);
      noeud = noeud.parentElement;
    }
    const cartouche = (el.querySelector("[data-slot='card-header']") as HTMLElement).parentElement as HTMLElement;
    expect(cartouche.className).toContain("row-start-1");
    expect(cartouche.className).toContain("self-end");
    // Le prix AVANT le titre dans le cartouche : il se lit en pastille au-dessus du nom.
    expect(cartouche.firstElementChild?.getAttribute("data-slot")).toBe("card-content");
    expect(el.querySelector("h3")?.className).toContain("uppercase");
    // Le cartouche au blanc bleuté de la charte (`--background`), pas le blanc pur de `--surface`
    // (référence de Jérôme du 2026-10-02).
    expect((el.querySelector("[data-slot='card-header']") as HTMLElement).className).toContain(
      "bg-[var(--background)]"
    );
    // Les bulles : le style vise les enfants DIRECTS, et le voile qui garantit le contraste du
    // texte blanc sur une photo claire est présent (voir `OVERLAY_BULLES_CLASS`).
    const contenu = el.querySelector("[data-slot='card-content']") as HTMLElement;
    expect(contenu.className).toContain("[&>*]:rounded-full");
    expect(contenu.className).toContain("[&>*]:bg-black/55");
  });

  it("rend le sous-titre entre le titre et la description", () => {
    const el = carte(
      <Card title="T" titleAs="h2" subtitle="3 habitaciones" description={DESCRIPTION}>
        <p>x</p>
      </Card>
    );
    const entete = el.querySelector("[data-slot='card-header']") as HTMLElement;
    const enfants = Array.from(entete.children).map((n) => n.getAttribute("data-slot") ?? n.tagName);
    expect(enfants).toEqual(["card-title", "P", "card-description"]);
    expect(entete.children[1].textContent).toBe("3 habitaciones");
  });

  // ⚠️ Constaté sur les cartes d'activité de l'accueil/listings : un titre court et un titre long
  // produisaient deux cartes de hauteurs différentes sur la même ligne de grille. `line-clamp-*`
  // fige la hauteur du texte quelle que soit sa longueur, plutôt que de laisser un CSS `truncate`
  // (une seule ligne partout) — un sous-titre/une description tiennent parfois sur deux lignes
  // sans devenir illisibles, contrairement au titre.
  it("fige la hauteur du texte — titre sur 1 ligne, sous-titre et description sur 2 lignes max", () => {
    const el = carte(
      <Card title={TITRE} titleAs="h2" subtitle="Un sous-titre plutôt long, sur deux lignes" description={DESCRIPTION}>
        <p>x</p>
      </Card>
    );
    expect(el.querySelector("h2")?.className).toContain("line-clamp-1");
    expect(el.querySelector("[data-slot='card-header'] > p")?.className).toContain("line-clamp-2");
    expect(el.querySelector("[data-slot='card-description']")?.className).toContain("line-clamp-2");
  });
});
