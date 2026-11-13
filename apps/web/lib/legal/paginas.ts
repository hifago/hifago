// Les cinq pages institutionnelles (cahier client §1, règle du 2026-08-11 ; routes fixées par la
// spec 27 §2). Une seule liste, lue par le pied de page et par le sitemap : ajouter une page, c'est
// ajouter une ligne ici, son dossier sous `app/[locale]/(vitrine)/(institucional)/` et sa clé
// `Chrome.<cle>`.
//
// Aucun import : ce module est lu par `SiteFooter` (client) comme par `app/sitemap.ts` (serveur).
export const PAGINAS_INSTITUCIONALES = [
  { href: "/legal", cle: "footerLegalNotice" },
  { href: "/terminos", cle: "footerTerms" },
  { href: "/privacidad", cle: "footerPrivacy" },
  { href: "/ayuda", cle: "footerHelp" },
  { href: "/contacto", cle: "footerContact" },
] as const;

export type PaginaInstitucional = (typeof PAGINAS_INSTITUCIONALES)[number];
