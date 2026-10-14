// Liste partagée entre PartnerNav.tsx (desktop) et PartnerMobileNav.tsx (mobile) — refonte vue
// prestataire (2026-08-19), extraite pour ne jamais laisser les deux diverger. "Mi establecimiento"
// et "Mis actividades" fusionnées en une seule entrée (la vue /partner/establishment affiche
// désormais chaque établissement avec ses activités liées juste dessous).
const ESTABLISHMENT_HREF = "/partner/establishment";
const RESERVATIONS_HREF = "/partner/reservations";

const ALL_NAV_ITEMS = [
  { href: "/partner", label: "Inicio" },
  { href: ESTABLISHMENT_HREF, label: "Mi establecimiento y servicios" },
  { href: RESERVATIONS_HREF, label: "Mis reservas" },
  { href: "/partner/commissions", label: "Mis comisiones" },
  { href: "/partner/tools", label: "Mi enlace y QR" },
  { href: "/partner/account", label: "Mi cuenta" },
] as const;

// Refonte vue référent (2026-08-20) : "Mi establecimiento y servicios" et "Mis reservas" n'ont
// rien à montrer à un référent pur (aucune capacité operator) — fermeture complète décidée par
// Jérôme, jamais un simple masquage v1-style qui garderait un CTA d'auto-évolution vers
// prestataire (cf. docs/specs/22-vue-referent-restreinte.md). `hasOperatorCapability` vient de
// lib/agenda/activeOperatorEstablishments.ts — n'importe quel statut ('active' ou 'suspended'),
// jamais actif-seulement (un opérateur suspendu garde accès à ses propres écrans).
export function getNavItems(hasOperatorCapability: boolean) {
  if (hasOperatorCapability) return ALL_NAV_ITEMS;
  return ALL_NAV_ITEMS.filter(
    (item) => item.href !== ESTABLISHMENT_HREF && item.href !== RESERVATIONS_HREF
  );
}

// /partner/products/* (fiche produit, disponibilité) est atteint uniquement en profondeur depuis
// /partner/establishment — jamais un lien de nav à part entière. Sans cette entrée,
// resolveActiveNavTitle (AppNavShell, titre de la barre mobile) retomberait sur le titre par
// défaut générique sur ces 6 routes ; ne sert QU'à la résolution du titre, jamais rendu comme lien.
export const EXTRA_TITLE_ROUTES = [{ href: "/partner/products", label: "Mi establecimiento y servicios" }];
