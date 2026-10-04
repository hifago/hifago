"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/atoms/LinkButton";
import { GlypheWhatsApp } from "@/components/atoms/GlypheWhatsApp";
import { LogoHifago } from "@/components/atoms/LogoHifago";
import { COLUMNA_PORTADA } from "@/components/atoms/PageShell";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { URL_WHATSAPP_HIFAGO } from "@/lib/contacto/whatsapp";

// Le footer de la vitrine (2026-09-02, vague 5). Avec le header livré la veille, l'app a enfin ses
// landmarks : `<header>`, `<main>` (PageShell), `<footer>`.
//
// ⚠️ `"use client"` obligatoire : ce fichier appelle `useTranslations` et rend `LinkButton`, qui
// importe le barrel `@hifago/ui` — dont le graphe fait planter `next build` dès qu'il atteint un
// Server Component (CLAUDE.md §11.16).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ LES CINQ LIENS INSTITUTIONNELS POINTENT AUJOURD'HUI VERS DU VIDE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Aucune de ces pages n'existe (vérifié le 2026-09-02 : `app/[locale]/` ne contient ni `legal`, ni
// `privacy`, ni `contact`, ni `help`, ni `terms`). Ce lot n'en crée aucune — il livre le footer,
// pas le contenu légal, qui reste à rédiger (docs/01-cahier-des-charges-client.md, règle du
// 2026-08-11).
//
// La liste elle-même n'est pas inventée : elle vient de cette règle — mentions légales, politique
// de confidentialité (cadre Habeas Data colombien), contact, aide/FAQ, et conditions générales.
//
// D'où UNE SEULE constante : le jour où les routes existent, c'est le seul endroit à changer. Et
// tant qu'elles n'existent pas, ce footer mène à cinq 404 — c'est dit dans le rapport de lot,
// parce qu'un footer qui a l'air fini est pire qu'un footer visiblement en chantier.
// ⚠️ VIDE DEPUIS LE 2026-09-07, et c'est délibéré. Les cinq liens institutionnels (mentions
// légales, confidentialité, contact, aide, conditions) pointaient vers des routes qui n'existent
// pas : ce footer menait à cinq 404. Jérôme a repoussé ces pages à la fin du chantier (cahier §1 :
// « seule leur présence est actée », leur contenu reste à rédiger). Un footer amputé pendant le
// chantier vaut mieux que cinq liens morts en production — et le jour où les pages existent, il
// suffit de remplir ce tableau, rien d'autre ne bouge.
const LIENS_INSTITUTIONNELS: readonly { href: string; cle: string }[] = [];

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
      {/* Plan 41, A6 — bande approuvée par Jérôme le 2026-10-03 après comparaison à 390 et
          1 280 px. Une image unique, jamais un motif répété : les bords de la source ne se
          raccordent pas. Décorative, différée et bornée pour ne jamais devenir le LCP. */}
      <Image
        src="/brand/motif-footer.webp"
        alt=""
        width={1600}
        height={120}
        sizes="100vw"
        loading="lazy"
        aria-hidden="true"
        className="block h-[clamp(48px,7.5vw,120px)] w-full object-cover object-center"
        data-testid={testId ? `${testId}-motif` : undefined}
      />
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

        {/* La navigation institutionnelle, VIDE tant que les pages n'existent pas (voir plus haut).
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
