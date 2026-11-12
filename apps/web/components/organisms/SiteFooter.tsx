"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/atoms/LinkButton";
import { BandeauLogos, type LogoBandeau } from "@/components/molecules/BandeauLogos";
import { GlypheWhatsApp } from "@/components/atoms/GlypheWhatsApp";
import { LogoHifago } from "@/components/atoms/LogoHifago";
import { COLUMNA_PORTADA } from "@/components/atoms/PageShell";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { URL_WHATSAPP_HIFAGO } from "@/lib/contacto/whatsapp";
import { IDENTIDAD_LEGAL } from "@/lib/legal/identidad";
import { PAGINAS_INSTITUCIONALES } from "@/lib/legal/paginas";

// Le footer de la vitrine (2026-09-02, vague 5). Avec le header livré la veille, l'app a enfin ses
// landmarks : `<header>`, `<main>` (PageShell), `<footer>`.
//
// ⚠️ `"use client"` obligatoire : ce fichier appelle `useTranslations` et rend `LinkButton`, qui
// importe le barrel `@hifago/ui` — dont le graphe fait planter `next build` dès qu'il atteint un
// Server Component (CLAUDE.md §11.16).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LES CINQ LIENS INSTITUTIONNELS (pages livrées le 2026-11-05)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Du 2026-09-07 au 2026-11-05 ce tableau était VIDE, délibérément : les pages n'existaient pas et
// un footer menant à cinq 404 valait moins qu'un footer amputé. Elles existent désormais sous
// `app/[locale]/(vitrine)/(institucional)/` ; la liste vit dans `lib/legal/paginas.ts`, lue aussi
// par le sitemap — une seule source pour les deux.
const LIENS_INSTITUTIONNELS = PAGINAS_INSTITUCIONALES;

// ⚠️ Le numéro de WhatsApp est DÉJÀ dans le dépôt : `apps/admin/lib/whatsapp.ts` porte le même
// (`SUPPORT_WHATSAPP_NUMBER`), lui-même repris du portail legacy (`public/reservar.js:15`), qui
// l'affiche sur toutes ses pages. Il est donc recopié ici plutôt qu'importé : `apps/admin` et
// `apps/web` sont deux applications, l'une n'importe pas l'autre.
//
// ⚠️ Cette troisième copie rend la remontée dans `packages/` justifiée au sens de CLAUDE.md §2.1 —
// la double consommation n'est plus supposée, elle est prouvée. C'est une décision d'architecture,
// donc signalée au coordinateur, pas prise ici.
// Le numéro vit désormais dans `lib/contacto/whatsapp.ts`, en une seule copie (2026-09-17) :
// il est aussi le repli de contact d'un transport sans téléphone propre. Ce module est isolé de
// Supabase, donc l'importer ici ne rapatrie rien dans le bundle.
const WHATSAPP_URL = URL_WHATSAPP_HIFAGO;

// Les logos du bandeau déroulant (Jérôme, 2026-10-13). LE SEUL endroit à changer pour en ajouter
// un : déposer le fichier dans `public/logos/` (WebP, fond transparent, rogné à son dessin),
// ajouter une ligne avec ses dimensions réelles — sa taille à l'écran, le nombre de répétitions et
// la vitesse se règlent seuls (`BandeauLogos`).
//
// ⚠️ Le pied est MARINE : un logo doit s'y lire. Celui de la mairie est en lettres blanches, il
// serait invisible sur une surface claire. `alt` = le nom propre de l'institution, jamais traduit.
const LOGOS_DU_PIED: readonly LogoBandeau[] = [
  {
    src: "/logos/municipio-guatape.webp",
    alt: "Municipio de Guatapé · Departamento de Antioquia",
    width: 443,
    height: 116,
  },
  {
    src: "/logos/guatape-pueblo-de-zocalos.webp",
    alt: "Guatapé · Pueblo de Zócalos y Colores",
    width: 805,
    height: 574,
  },
];

export type SiteFooterProps = {
  testId?: string;
};

export function SiteFooter({ testId }: SiteFooterProps) {
  const t = useTranslations("Chrome");

  return (
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // LE PIED MARINE (plan 41, item C2 ; arbitrage D3 = A : marine partout, accueil compris)
    // ─────────────────────────────────────────────────────────────────────────────────────────
    //
    // Jusqu'au 2026-10-02, une bande claire (`--surface-tertiary`) bordée d'un filet marine : elle
    // fermait mal la page or de l'accueil. Le marine de la charte la ferme franchement, et reprend
    // sa déclinaison sombre (logo or + bleu poudre, page 4 de la charte).
    //
    // `data-superficie="marine"` (F3) : le fond, et les jetons de ce qui s'y lit — texte blanc
    // (13.07:1), discret en bleu poudre (8.02:1), focus or (6.31:1). Aucune couleur ici : le
    // bouton or garde ses propres jetons, le popover de langue se déclare surface claire.
    //
    // ⚠️ La raison pour laquelle l'ancienne version refusait un aplat franc — « le LinkButton
    // rendrait son texte sombre sur un fond sombre, le panneau du LanguageSwitcher garde son
    // `--surface` » — est levée par les surfaces : c'est exactement ce qu'elles règlent.
    <footer data-superficie="marine" data-testid={testId}>
      {/* Le bandeau déroulant de logos (Jérôme, 2026-10-13). Il prend la place de la bande
          décorative du plan 41 (A6, posée le 2026-10-03) : même bord haut du pied, mais du contenu
          — chaque logo est nommé — au lieu d'un décor. */}
      <BandeauLogos logos={LOGOS_DU_PIED} testId={testId ? `${testId}-logos` : undefined} />
      {/* La colonne de l'accueil, comme le header (C1) et le contenu (F7). 32 px en haut et 24 en
          bas sur mobile, 40 et 32 à partir de `md`. */}
      <div className={`${COLUMNA_PORTADA} flex flex-col gap-6 pt-8 pb-6 md:pt-10 md:pb-8`}>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col items-start gap-2">
            {/* Le logo pour fond sombre, FORCÉ quel que soit le mode (variante `sombre`). Il n'est
                pas un lien : le logo du header mène déjà à l'accueil. 56 px : le WebP garde une
                marge de 10 à 12 px, le dessin en fait ≈ 45. */}
            <LogoHifago variante="sombre" hauteur="h-14" />
            {/* La ligne d'identité, reprise du footer legacy (`public/index.html:503`). Bleu poudre
                14 px (`--muted` de la surface marine, 8.02:1) : sur l'ancienne bande claire, le
                discret tombait à 4.21:1 et la discrétion venait de la seule taille (12 px). */}
            <p className="text-sm text-muted" data-testid={testId ? `${testId}-identity` : undefined}>
              {t("footerIdentity")}
            </p>
            {/* Le numéro RNT sur toutes les pages (2026-11-12) : un prestataire touristique le
                porte dans sa communication (Ley 2068 de 2020), pas seulement sur l'aviso legal.
                Lu dans `lib/legal/identidad.ts`, la seule source — jamais recopié. */}
            {IDENTIDAD_LEGAL.rnt ? (
              <p className="text-sm text-muted" data-testid={testId ? `${testId}-rnt` : undefined}>
                {t("footerRnt", { rnt: IDENTIDAD_LEGAL.rnt })}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            {/* ⚠️ `LinkButton` avec `external`, pas un `<a>` écrit à la main : il impose
                `rel="noopener noreferrer"` (la prop `rel` n'existe pas, donc rien à oublier) et
                exige le libellé « nouvel onglet », rendu en sr-only. Plein or, texte marine
                (6.31:1) : l'action du pied, à la couleur des actions de la charte. */}
            <LinkButton
              href={WHATSAPP_URL}
              external
              newTabLabel={t("footerWhatsAppNewTab")}
              variant="solid"
              color="accent"
              iconBefore={<GlypheWhatsApp />}
              testId={testId ? `${testId}-whatsapp` : undefined}
            >
              {t("footerWhatsApp")}
            </LinkButton>

            {/* ⚠️ Le MÊME `LanguageSwitcher` que le header, réutilisé tel quel — pas un second
                sélecteur. Deux implémentations qui divergent (l'une qui navigue vraiment, l'autre
                en JavaScript seul) est le défaut classique de la paire header/footer, et il
                coûterait ici la découverte de la version anglaise. Variante menu : son texte suit
                la surface (blanc), son panneau reste une surface claire. */}
            <LanguageSwitcher testId={testId ? `${testId}-language` : undefined} />
          </div>
        </div>

        {/* La navigation institutionnelle (voir plus haut).
            `has-[ul:empty]:hidden` : une liste vide ne laisse ni landmark muet ni l'écart de 24 px
            d'un enfant sans hauteur — sans rien masquer selon la largeur. Le jour où le tableau se
            remplit, elle réapparaît d'elle-même. */}
        <nav
          aria-label={t("footerNavLabel")}
          className="has-[ul:empty]:hidden"
          data-testid={testId ? `${testId}-nav` : undefined}
        >
          {/* Mobile d'abord : la liste s'EMPILE à 390 px, elle ne se comprime pas — et rien n'est
              masqué selon la largeur, Google indexe le mobile. À partir de `sm` elle se replie sur
              deux ou trois colonnes de flux. */}
          <ul className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {LIENS_INSTITUTIONNELS.map(({ href, cle }) => (
              <li key={href}>
                <Link
                  href={href}
                  // `min-h-11` : 44 px de cible tactile (components/README.md). Bleu poudre
                  // (`--muted` de la surface marine), souligné au survol (plan 41, C2).
                  className="inline-flex min-h-11 items-center rounded-[var(--radius)] text-sm text-muted underline-offset-4 hover:underline focus-visible:status-focused"
                  data-testid={testId ? `${testId}-${cle}` : undefined}
                >
                  {t(cle)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
