"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/atoms/LinkButton";
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

// Le glyphe de WhatsApp, en `currentColor` (le texte marine du bouton or) : la marque se reconnaît
// à sa forme, et une icône de marque recolorée au thème reste la convention des pieds de page.
// Décoratif — le libellé du bouton dit déjà « WhatsApp ». Tracé du jeu Simple Icons (CC0).
function GlypheWhatsApp() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

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
