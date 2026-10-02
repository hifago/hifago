"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Chevron } from "@/components/atoms/Chevron";
import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { empujarConservandoQuery } from "@/lib/navigation/conservarQuery";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/messages";

// Le sélecteur de langue de la vitrine (2026-09-02, vague 4).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// TROIS DÉCISIONS, TOUTES VÉRIFIÉES PLUTÔT QUE SUPPOSÉES
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. ⚠️ CE SONT DE VRAIS LIENS, jamais `useRouter().replace()`. Un sélecteur qui ne navigue qu'en
//    JavaScript ne produit aucun `<a href>` : la version anglaise n'est alors découverte par aucun
//    maillage interne, et le sélecteur ne marche pas sans JS. Le `Link` de `@/i18n/navigation`
//    accepte une prop `locale` — `<Link href={pathname} locale="en">` rend un vrai `/en/…`.
//
// 2. ⚠️ PAS de `Dropdown`/`Popover` de HeroUI, et ce n'est pas un choix de style. Mesuré en rendu
//    SERVEUR (`renderToStaticMarkup`) le 2026-09-02 : un `Dropdown` fermé ne contient AUCUN de ses
//    liens dans le HTML servi — react-aria ne monte le contenu qu'à l'ouverture. Or sur mobile ce
//    sélecteur vit dans le menu du header, et Googlebot indexe la version mobile : les liens de
//    langue disparaîtraient donc du seul HTML qu'il voit. Ici le panneau est TOUJOURS rendu et
//    seulement masqué (`hidden`), ce que `LanguageSwitcher.test.tsx` vérifie en SSR.
//    Contrepartie assumée : `Échap`, le clic à l'extérieur et le retour du focus sont écrits à la
//    main plus bas — c'est ce que le popover aurait donné gratuitement.
//
// 3. ⚠️ LE DRAPEAU N'EST JAMAIS SEUL À PORTER L'INFORMATION (même règle que la couleur, dans
//    components/README.md). Deux raisons : les drapeaux en emoji ne s'affichent PAS sous Windows
//    (le système n'embarque aucun glyphe de drapeau, `🇪🇸` y rend « ES ») — d'où des SVG inline ;
//    et surtout aucun drapeau ne « dit » une langue. Le nom (ou son abréviation) est donc toujours
//    écrit à côté.
//    ⚠️ LE DRAPEAU ESPAGNOL depuis le 2026-10-01, et c'est un revirement : `es` portait jusque-là
//    le drapeau COLOMBIEN (l'espagnol parlé à Guatapé). La maquette de l'accueil fournie par Jérôme
//    montre celui de l'Espagne — appliqué PARTOUT et pas seulement sur l'accueil, sinon le header et
//    le pied de la même page afficheraient deux drapeaux différents pour la même langue. Revenir au
//    drapeau colombien = changer la seule ligne `es:` de la table `DRAPEAUX`.
//
// 4. DEUX APPARENCES, UN SEUL COMPOSANT (2026-10-01). `menu` (défaut) est le déclencheur déroulant
//    décrit ci-dessus. `banderas` est la rangée de la maquette de l'accueil — « 🇪🇸 ESP  🇬🇧 ING »,
//    les deux langues en liens directs, sans menu : le header transparent de l'accueil n'a pas de
//    panneau où ranger un déroulant. Les liens y sont les MÊMES (vrais `<a href>`, `locale`, query
//    conservée au clic) : seul l'habillage change. Sous `md`, la rangée se réduit à UN bouton, la
//    langue vers laquelle basculer (2026-10-02).
export type LanguageSwitcherProps = {
  /** `menu` (défaut) : déclencheur + panneau. `banderas` : les langues en ligne, drapeau + abréviation. */
  apariencia?: "menu" | "banderas";
  testId?: string;
};

// ⚠️ Les noms de langue ne sont PAS des chaînes traduisibles : chaque langue s'écrit dans la
// sienne (un anglophone perdu sur /es doit lire « English », pas « Inglés »). Ils ne passent donc
// pas par les messages — même parti pris que `.storybook/preview.tsx`, qui porte déjà cette table.
const ENDONYMES: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

// L'écu est réduit à une silhouette : à 24 × 16 px, ses quartiers seraient une tache — c'est aussi
// ce que montre la maquette.
function DrapeauEspagne() {
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6 shrink-0 rounded-[2px] ring-1 ring-black/10" aria-hidden="true">
      <rect width="24" height="16" fill="#AA151B" />
      <rect y="4" width="24" height="8" fill="#F1BF00" />
      <rect x="5.4" y="6.1" width="3.2" height="3.9" rx="1" fill="#AD1519" />
      <rect x="5.1" y="5.3" width="3.8" height="0.9" rx="0.3" fill="#AD1519" />
    </svg>
  );
}

function DrapeauRoyaumeUni() {
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6 shrink-0 rounded-[2px] ring-1 ring-black/10" aria-hidden="true">
      <rect width="24" height="16" fill="#012169" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#FFF" strokeWidth="3" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M12 0v16M0 8h24" stroke="#FFF" strokeWidth="5" />
      <path d="M12 0v16M0 8h24" stroke="#C8102E" strokeWidth="3" />
    </svg>
  );
}

const DRAPEAUX: Record<Locale, () => React.ReactElement> = {
  es: DrapeauEspagne,
  en: DrapeauRoyaumeUni,
};

export function LanguageSwitcher({ apariencia = "menu", testId }: LanguageSwitcherProps) {
  const t = useTranslations("Chrome");
  const chemin = usePathname();
  const router = useRouter();
  // La locale rendue vient de next-intl, jamais de l'URL : `usePathname` de `@/i18n/navigation`
  // retire justement le préfixe de locale, il ne peut donc pas la donner.
  const locale = useLocale() as Locale;
  const [ouvert, setOuvert] = useState(false);
  const idPanneau = useId();
  const conteneur = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);

  // Ce qu'un popover react-aria aurait apporté seul (voir le point 2 de l'en-tête) : `Échap` ferme
  // et REND LE FOCUS au bouton — sans ce retour, le focus reste sur un élément masqué et la
  // tabulation repart du début du document.
  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key !== "Escape") return;
      setOuvert(false);
      declencheur.current?.focus();
    };
    const surClic = (evenement: MouseEvent) => {
      if (!conteneur.current?.contains(evenement.target as Node)) setOuvert(false);
    };
    document.addEventListener("keydown", surTouche);
    document.addEventListener("mousedown", surClic);
    return () => {
      document.removeEventListener("keydown", surTouche);
      document.removeEventListener("mousedown", surClic);
    };
  }, [ouvert]);

  // ⚠️ Branche APRÈS tous les hooks, jamais avant : un `return` anticipé au-dessus de `useState`
  // changerait l'ordre des hooks d'un rendu à l'autre (règle des hooks de React).
  if (apariencia === "banderas") {
    return (
      // Un `<nav>` nommé : c'est un ensemble de liens de navigation, distinct de celui du compte et
      // du panier dans le même header — deux `<nav>` cohabitent sans ambiguïté s'ils sont nommés.
      <nav aria-label={t("languageLabel")} data-testid={testId}>
        <ul className="flex items-center gap-1 sm:gap-3">
          {routing.locales.map((valeur) => {
            const Drapeau = DRAPEAUX[valeur];
            const courante = valeur === locale;
            return (
              // ⚠️ UN SEUL BOUTON SOUS `md` (demande de Jérôme, 2026-10-02, vue mobile) : la langue
              // COURANTE y est masquée, il ne reste que l'autre — un bouton qui bascule. Masquée et
              // non retirée du rendu : on cache un lien vers la page même, jamais un `/en/…` (seule
              // cible que le maillage doit garder pour Googlebot, voir le point 2 de l'en-tête). Au-
              // dessus de `md`, la rangée « ESP · ING » de la maquette, inchangée.
              <li key={valeur} className={courante ? "hidden md:block" : undefined}>
                <Link
                  href={chemin}
                  locale={valeur}
                  hrefLang={valeur}
                  aria-current={courante ? "true" : undefined}
                  // `min-h-11` : 44 px de cible tactile. Anton (`--font-sous-titre`), la police que la
                  // charte réserve aux sous-titres — celle de « ESP · ING » sur la maquette.
                  className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-1.5 font-[family-name:var(--font-sous-titre)] text-base leading-none underline-offset-4 hover:underline focus-visible:status-focused"
                  onClick={(evenement) => {
                    evenement.preventDefault();
                    empujarConservandoQuery(router, chemin, { locale: valeur });
                  }}
                  data-testid={testId ? `${testId}-${valeur}` : undefined}
                >
                  <Drapeau />
                  {/* L'abréviation est un libellé d'INTERFACE (« ING » en espagnol, « ENG » en
                      anglais), contrairement aux endonymes du menu : elle passe donc par les
                      messages. */}
                  <span>{t(`idiomaCorto.${valeur}`)}</span>
                  {/* ⚠️ Le nom complet, dans SA langue, pour le lecteur d'écran — et APRÈS
                      l'abréviation visible, pas à sa place : le nom accessible doit CONTENIR le
                      libellé affiché (WCAG 2.5.3), sinon « clique sur ING » ne trouve rien en
                      commande vocale. « ING (English) ». */}
                  <span className="sr-only" lang={valeur}>
                    {` (${ENDONYMES[valeur]})`}
                  </span>
                  {courante ? <span className="sr-only">{`, ${t("languageCurrentLabel")}`}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  const DrapeauCourant = DRAPEAUX[locale];

  return (
    <div ref={conteneur} className="relative" data-testid={testId}>
      <button
        ref={declencheur}
        type="button"
        // ⚠️ `min-h-11` : cible tactile de 44 px (components/README.md), comme toute la famille des
        // boutons. Un sélecteur de langue est une cible qu'on vise au pouce.
        className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-3 text-sm font-medium hover:bg-default focus-visible:status-focused"
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        onClick={() => setOuvert((etat) => !etat)}
        data-testid={testId ? `${testId}-trigger` : undefined}
      >
        <DrapeauCourant />
        <span>{ENDONYMES[locale]}</span>
        <Chevron ouvert={ouvert} />
        {/* Ce que le bouton EST, pour un lecteur d'écran : le drapeau et le nom ne disent pas qu'on
            peut changer de langue. */}
        <span className="sr-only">&nbsp;— {t("languageLabel")}</span>
      </button>

      {/* ⚠️ TOUJOURS rendu, seulement masqué : c'est ce qui met les liens `/en/…` dans le HTML que
          Googlebot reçoit. Un `{ouvert && …}` les en sortirait — voir le point 2 de l'en-tête. */}
      <div
        id={idPanneau}
        hidden={!ouvert}
        className="absolute right-0 top-full z-10 mt-1 flex min-w-44 flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
        data-testid={testId ? `${testId}-panneau` : undefined}
      >
        {routing.locales.map((valeur) => {
          const Drapeau = DRAPEAUX[valeur];
          const courante = valeur === locale;
          return (
            <Link
              key={valeur}
              href={chemin}
              locale={valeur}
              // `aria-current` plutôt qu'une coche seule : l'information « c'est la langue active »
              // ne doit pas dépendre d'un signe visuel.
              aria-current={courante ? "true" : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-3 text-sm hover:bg-default focus-visible:status-focused"
              // ⚠️ `href`/`locale` restent STATIQUES (dégradation sans JS, découverte par un
              // crawler — voir le point 2 de l'en-tête) ; la query string active est ajoutée au
              // clic par `empujarConservandoQuery`, qui porte le raisonnement complet. Bug Jérôme
              // du 2026-09-16 : changer de langue effaçait les filtres actifs.
              onClick={(evenement) => {
                evenement.preventDefault();
                setOuvert(false);
                empujarConservandoQuery(router, chemin, { locale: valeur });
              }}
              data-testid={testId ? `${testId}-${valeur}` : undefined}
            >
              <Drapeau />
              <span>{ENDONYMES[valeur]}</span>
              {courante ? <span className="sr-only">({t("languageCurrentLabel")})</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
