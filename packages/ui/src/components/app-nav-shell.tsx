"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, XIcon } from "lucide-react";
import { Button } from "@heroui/react";
import {
  ModalRoot as Modal,
  ModalBackdrop,
  ModalContainer,
  ModalDialog,
  ModalHeader,
  ModalHeading,
  ModalBody,
  ModalFooter,
  ModalCloseTrigger,
} from "@heroui/react";
import { useOverlayState } from "@heroui/react";
import { cn } from "../lib/utils";

/**
 * Coquille de navigation responsive partagée par /admin et /partner (apps/admin) — remplace
 * AdminSidebar.tsx (aucun comportement mobile) et PartnerNav.tsx/PartnerMobileNav.tsx (bottom-
 * sheet avec titre de marque statique) par UN seul composant testé une fois. Sidebar desktop et
 * barre+panneau mobile rendus depuis le MÊME tableau `navItems`, split CSS only (`hidden md:flex`
 * / `md:hidden`) — jamais de useMediaQuery, jamais de flash d'hydratation.
 *
 * Charte Hifago (2026-10-13) : la barre latérale et la barre mobile sont une SURFACE MARINE
 * (`data-superficie="marine"`, thème admin de `styles/globals.css`) — c'est elle qui donne aux
 * jetons lus ici (`text-muted`, `border-border`, `hover:bg-surface-secondary`) leur valeur lisible
 * sur le marine. Le lien actif est le seul aplat or : « où je suis » se lit d'un coup d'œil. Le
 * panneau mobile, lui, est une modale rendue au bout du <body> : il reste clair.
 */

export type AppNavItem = { href: string; label: string; badge?: number; badgeTestId?: string };

export type AppNavShellTestIds = {
  desktopNav: string;
  desktopLinkPrefix: string;
  mobileTrigger: string;
  mobileTitle: string;
  mobileLinkPrefix: string;
};

export type AppNavShellProps = {
  navItems: readonly AppNavItem[];
  /** Routes atteintes en profondeur mais jamais rendues comme lien de nav — sert uniquement à
   *  résoudre le titre mobile (ex. /partner/products/*, atteint depuis /partner/establishment). */
  extraTitleRoutes?: readonly AppNavItem[];
  ariaLabel: string;
  fallbackTitle: string;
  testIds: AppNavShellTestIds;
  /** Logo, en tête de la barre latérale et à gauche de la barre mobile. Rendu sur le marine :
   *  passer la déclinaison « sombre » du logo. */
  brand?: React.ReactNode;
  desktopFooter?: React.ReactNode;
  mobileFooter?: React.ReactNode;
};

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/admin" || href === "/partner") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Résout le titre à afficher dans la barre mobile à partir du MÊME tableau `navItems` que la nav
 * elle-même (préfixe le plus long gagnant) — pas de map pathname→titre séparée à maintenir en
 * parallèle (risque de désynchronisation), pas de Context à brancher sur ~44 page.tsx pour un
 * gain nul par rapport à un libellé de section compact (pattern standard des barres de nav
 * mobiles natives : titre compact dans la barre, titre complet dans le contenu de la page).
 */
export function resolveActiveNavTitle(pathname: string, items: readonly AppNavItem[], fallback: string): string {
  const matches = items.filter((item) => isRouteActive(pathname, item.href));
  if (matches.length === 0) return fallback;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).label;
}

/**
 * `inverted` reprend les couleurs quand le lien porteur est déjà actif (fond rouge plein sur fond
 * accent = peu lisible) : fond blanc / texte rouge plutôt que fond rouge / texte blanc — retour
 * Jérôme explicite (porté depuis nav-badge.tsx), jamais un token bg-background (suivrait un
 * éventuel thème sombre), un vrai blanc pour trancher net sur n'importe quelle couleur d'accent.
 */
function NavBadgePill({
  count,
  inverted = false,
  testId,
}: {
  count: number;
  inverted?: boolean;
  testId?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      data-testid={testId}
      className={cn(
        "ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
        inverted ? "bg-white text-danger" : "bg-danger text-danger-foreground"
      )}
    >
      {count}
    </span>
  );
}

export function AppNavShell({
  navItems,
  extraTitleRoutes,
  ariaLabel,
  fallbackTitle,
  testIds,
  brand,
  desktopFooter,
  mobileFooter,
}: AppNavShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Ferme le panneau au clic sur un lien (onClick explicite, avant que la navigation ne parte) —
  // constaté à l'usage réel (PartnerMobileNav.tsx, 2026-08-19) que la seule comparaison
  // pathname/prevPathname pendant le rendu ne suffit pas seule : gardée en complément, jamais en
  // remplacement, comme filet pour le bouton retour/avant du navigateur (ne passe par aucun onClick).
  const [prevPathname, setPrevPathname] = React.useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  const state = useOverlayState({ isOpen: open, onOpenChange: setOpen });

  // Mémoïsés : navItems/extraTitleRoutes gardent la même référence tant que le layout parent
  // (AdminNav/PartnerAppNav) ne se re-rend pas — donc stables pendant les re-rendus internes de
  // ce composant (ouverture/fermeture du panneau mobile via `open`, qui ne change pas `pathname`).
  // Sans ça, resolveActiveNavTitle et isRouteActive tournaient à chaque frappe d'état, y compris
  // quand ni la route ni la liste de liens n'avaient changé.
  const titleItems = React.useMemo(
    () => (extraTitleRoutes ? [...navItems, ...extraTitleRoutes] : navItems),
    [navItems, extraTitleRoutes]
  );
  const mobileTitle = React.useMemo(
    () => resolveActiveNavTitle(pathname, titleItems, fallbackTitle),
    [pathname, titleItems, fallbackTitle]
  );
  const activeHrefs = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of navItems) {
      if (isRouteActive(pathname, item.href)) set.add(item.href);
    }
    return set;
  }, [pathname, navItems]);

  return (
    <>
      {/* Barre mobile : titre en haut à gauche, bouton en haut à droite qui déplie un panneau plein écran */}
      <div
        data-superficie="marine"
        className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border px-4 py-2 md:hidden"
      >
        {/* Un <p>, pas un <h1> : chaque page porte déjà le sien, et la barre en affichait un
            second sur mobile. Le libellé de section reste lu, sans doubler le titre de la page. */}
        <div className="flex min-w-0 items-center gap-3">
          {brand}
          <p className="truncate text-base font-semibold" data-testid={testIds.mobileTitle}>
            {mobileTitle}
          </p>
        </div>
        <Button
          type="button"
          isIconOnly
          variant="outline"
          size="sm"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          data-testid={testIds.mobileTrigger}
          onPress={() => setOpen(!open)}
        >
          {open ? <XIcon className="size-5" aria-hidden /> : <MenuIcon className="size-5" aria-hidden />}
        </Button>

        <Modal state={state}>
          <ModalBackdrop>
            <ModalContainer placement="top" size="full">
              <ModalDialog aria-label={ariaLabel}>
                <ModalHeader>
                  <ModalHeading>Menú</ModalHeading>
                  <ModalCloseTrigger aria-label="Cerrar menú" />
                </ModalHeader>
                <ModalBody className="flex flex-col gap-1">
                  {navItems.map((item) => {
                    const active = activeHrefs.has(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        data-testid={`${testIds.mobileLinkPrefix}-${item.href.replace(/\//g, "-")}`}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex min-h-11 items-center justify-between rounded-md px-3 py-2 text-base font-medium transition-colors",
                          active
                            ? "bg-accent font-semibold text-accent-foreground"
                            : "text-foreground hover:bg-surface-secondary"
                        )}
                      >
                        <span>{item.label}</span>
                        {item.badge ? (
                          <NavBadgePill
                            count={item.badge}
                            inverted={active}
                            testId={item.badgeTestId ? `${item.badgeTestId}-mobile` : undefined}
                          />
                        ) : null}
                      </Link>
                    );
                  })}
                </ModalBody>
                {mobileFooter ? <ModalFooter className="flex flex-col gap-2">{mobileFooter}</ModalFooter> : null}
              </ModalDialog>
            </ModalContainer>
          </ModalBackdrop>
        </Modal>
      </div>

      {/* Sidebar desktop : même tableau navItems, split CSS only */}
      <nav
        aria-label={ariaLabel}
        data-testid={testIds.desktopNav}
        data-superficie="marine"
        className="hidden w-56 shrink-0 flex-col gap-1 p-4 md:sticky md:top-0 md:flex md:h-screen md:overflow-y-auto"
      >
        {brand ? <div className="mb-4 px-3 pt-1">{brand}</div> : null}
        {navItems.map((item) => {
          const active = activeHrefs.has(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`${testIds.desktopLinkPrefix}-${item.href.replace(/\//g, "-")}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent font-semibold text-accent-foreground"
                  : "text-muted hover:bg-surface-secondary hover:text-foreground"
              )}
            >
              <span>{item.label}</span>
              {item.badge ? (
                <NavBadgePill count={item.badge} inverted={active} testId={item.badgeTestId} />
              ) : null}
            </Link>
          );
        })}
        {desktopFooter ? <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">{desktopFooter}</div> : null}
      </nav>
    </>
  );
}
