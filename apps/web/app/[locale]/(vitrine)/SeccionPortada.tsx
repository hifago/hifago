import NextImage from "next/image";
import { Link } from "@/i18n/navigation";
import type { TarjetaOferta } from "@/lib/catalog/tipos";

// UNE SECTION DE L'ACCUEIL, telle que la dessine la maquette de Jérôme (2026-10-01) :
//
//     Actividades●                       ← titre (police de titre), point bleu poudre
//     ──────────────────────             ← trait marine sur 68 % de la colonne
//     ░░░░░░░░░░░░░░░░░░░░░░             ← le motif de la charte (asset fourni), derrière…
//     ░░░ ┌──────────────────────────┐   ← …le conteneur MARINE, décalé de 7,5 % vers la droite
//     ░░░ │ [photo] [photo] [photo]  │
//         └──────────────────────────┘
//                                GO →    ← le lien vers la page du type
//
// ⚠️ UNE NOUVELLE SECTION, ET NON UNE CINQUIÈME VARIANTE DE `SeccionOfertas`. Cette dernière sert
// AUSSI les pages d'index par catégorie (`IndiceCategoriasConOfertas`), qui n'ont pas changé de
// maquette : la modifier aurait redessiné des écrans que personne n'a demandé de toucher. Celle-ci
// ne sert que l'accueil, d'où sa place à côté de `page.tsx` (`apps/web/components/README.md`).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// TOUT EST EN `cqw` — les proportions de la maquette, mesurées au pixel, à toute largeur
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La section est un conteneur de requête (`@container`) : `1cqw` = 1 % de SA largeur, qui est celle
// de la colonne. Chaque écart ci-dessous est une mesure de la maquette (colonne de 572 px) divisée
// par cette largeur — 43 px de décalage du conteneur = 7,5cqw, 15 px de marge intérieure = 2,6cqw…
// La maquette se retrouve donc à l'identique à 390 comme à 1 280 px, au lieu d'être juste à une
// seule largeur. Seules les tailles de TEXTE sont bornées (`clamp`), pour rester lisibles.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// TROIS PHOTOS À L'ÉCRAN, HUIT DANS LE DOM — et pourquoi pas trois tout court
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La maquette montre trois photos. La page en sert jusqu'à huit (`POR_SECCION`, cahier §2a), et les
// e2e (`e2e/home.spec.ts`) cliquent des offres NOMMÉES qui ne sont pas forcément dans les trois
// premières. La rangée défile donc DANS le conteneur, trois photos exactement à l'écran : au repos,
// c'est la maquette ; au doigt, au trackpad ou à la tabulation, les cinq autres viennent. La barre
// de défilement est masquée — la maquette n'en a pas, et « GO → » mène de toute façon à la liste
// complète. Pas de `tabIndex`/`role="region"` sur la rangée : elle ne contient que des liens, donc
// elle est déjà atteignable au clavier (`.claude/rules/ui.md`).
//
// ⚠️ PAS DE "use client" : aucune donnée de navigateur, aucun état. Le HTML des cinq sections est
// SERVI — c'est lui que Google indexe, et c'est le contenu principal de la page.
export type SeccionPortadaProps = {
  /** Déjà traduit — c'est aussi le nom accessible de la section. */
  titulo: string;
  /** Critères de recherche déjà inclus. */
  hrefVerMas: string;
  /** Déjà traduit (« Más actividades »). Nom accessible du lien « GO → », que l'œil lit « GO ». */
  labelVerMas: string;
  /** Faux sous une recherche qui ne laisse rien de plus à voir que ces cartes (voir `page.tsx`). */
  mostrarVerMas: boolean;
  tarjetas: TarjetaOferta[];
  testId?: string;
};

// La largeur d'une photo : 27,83cqw, et ce n'est pas une valeur choisie — c'est le TIERS de
// l'intérieur du conteneur plein (92,5cqw − 2 × 2,6cqw de marge − 2 × 1,9cqw de gouttière = 83,5cqw),
// donc exactement trois photos à l'écran. En `cqw` et non en `%` du conteneur, et c'est ce qui permet
// au conteneur d'ÉPOUSER ses photos quand il y en a moins de trois (`w-fit`) : un pourcentage de sa
// largeur serait circulaire. Demande de Jérôme du 2026-10-01, sur la version précédente : « il ne
// doit pas être rectangulaire » — deux photos ne laissent pas un tiers de marine vide.
const CLASE_TESELA = "w-[27.83cqw] shrink-0 snap-start";

// `sizes` suit `CLASE_TESELA` : 285 px quand la colonne est à son plafond (1 024 px, atteint à
// 1 088 px d'écran), environ 26 % de l'écran en dessous (97 px sur un écran de 390).
const SIZES_TESELA = "(min-width: 1088px) 285px, 26vw";

function Tesela({ oferta }: { oferta: TarjetaOferta }) {
  // La PREMIÈRE photo seulement : la maquette montre une image par offre, pas un carrousel dans une
  // vignette de 100 px.
  const foto = oferta.fotos[0]?.url ?? null;

  return (
    <li className={CLASE_TESELA}>
      <div
        className="group relative aspect-[20/21] overflow-hidden rounded-[2.4cqw] bg-[var(--default)]"
        data-testid={oferta.testId}
      >
        {foto ? (
          // `alt=""` : le lien qui couvre la tuile porte déjà le nom de l'offre — une description
          // de la photo le répéterait (« Kayak en el embalse, foto 1 de 3 », lu deux fois).
          <NextImage
            src={foto}
            alt=""
            fill
            sizes={SIZES_TESELA}
            className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none"
          />
        ) : null}
        {/* Le lien COUVRE la tuile. Son nom accessible est le nom de l'offre, posé en légende : à
            l'œil elle n'apparaît qu'au survol ou au focus (la maquette n'en montre aucune), mais
            elle reste dans le DOM — lue par un lecteur d'écran, indexée par un moteur. ⚠️ Ce n'est
            pas le « contenu masqué derrière une interaction » de `.claude/rules/seo.md` §7, qui vise
            un contenu ABSENT du HTML tant qu'on n'a pas cliqué : ce nom-ci est dans le HTML servi,
            c'est le texte même du lien ; seule son apparition à l'œil attend le survol.
            Focus : un anneau OR intérieur — le bleu de `--focus` ne se verrait pas sur le marine du
            conteneur, et un anneau extérieur serait rogné par la rangée qui défile. */}
        <Link
          href={oferta.href}
          className={`absolute inset-0 z-[1] flex rounded-[inherit] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
            foto ? "items-end" : "items-center justify-center"
          }`}
          data-testid={`${oferta.testId}-link`}
        >
          {foto ? (
            <span className="w-full bg-gradient-to-t from-[color-mix(in_oklab,var(--charte-marine)_88%,transparent)] to-transparent px-[1.6cqw] pt-[5cqw] pb-[1.4cqw] text-[clamp(0.75rem,1.6cqw,1rem)] font-medium leading-tight text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
              {oferta.nombre}
            </span>
          ) : (
            // SANS PHOTO, le nom est VISIBLE en permanence — sinon la tuile serait un carré bleu
            // muet, sans rien qui dise ce qu'on y trouve. Marine sur bleu poudre : 8.02:1.
            <span className="line-clamp-4 px-[1.6cqw] text-center text-[clamp(0.75rem,1.8cqw,1.125rem)] font-medium leading-tight text-[var(--default-foreground)]">
              {oferta.nombre}
            </span>
          )}
        </Link>
      </div>
    </li>
  );
}

export function SeccionPortada({
  titulo,
  hrefVerMas,
  labelVerMas,
  mostrarVerMas,
  tarjetas,
  testId,
}: SeccionPortadaProps) {
  return (
    // `aria-label` : une <section> sans nom n'est pas un repère de navigation. Le nom est le titre
    // visible, jamais un libellé parallèle qui divergerait.
    <section aria-label={titulo} className="@container" data-testid={testId}>
      {/* Le titre prend la police de titre par la règle de base des `<h2>` (`globals.css`, avec son
          interlettrage) : rien à poser ici. 6,3 % de la colonne, comme la maquette — borné à 28 px et
          à 60 px (la taille que Jérôme a retenue pour les titres de l'accueil le 2026-10-01). Le
          POINT est un bloc vide en ligne : sa base est son bord bas, il s'assied donc sur la ligne
          de base du texte, comme sur la maquette. Décoratif. */}
      <h2
        className="text-[clamp(1.75rem,6.3cqw,3.75rem)] leading-none"
        data-testid={testId ? `${testId}-titulo` : undefined}
      >
        {titulo}
        <span
          aria-hidden="true"
          className="ml-[0.14em] inline-block size-[0.3em] rounded-full bg-[var(--default)]"
        />
      </h2>

      {/* Le trait sous le titre : 68 % de la colonne, comme le motif qu'il surmonte. */}
      <div aria-hidden="true" className="mt-[0.8cqw] h-[clamp(2px,0.5cqw,4px)] w-[68cqw] bg-current" />

      {/* `pt-[6.3cqw]` et non une marge sur le conteneur : une marge haute sur le premier enfant
          FUSIONNE avec celle de ce bloc (constaté au rendu — le motif démarrait au niveau du
          conteneur au lieu de le dépasser au-dessus). Un padding ne fusionne pas. */}
      <div className="relative mt-[1.4cqw] pt-[6.3cqw]">
        {/* LE MOTIF — l'asset fourni par Jérôme (`motif-bleu-section.webp`, son bleu `#3c90d4` tel
            quel : c'est celui de la maquette), à la largeur du trait et à ses proportions. En fond
            CSS : purement décoratif, aucun `<img>` à annoncer. Le conteneur marine le recouvre ; il
            n'en dépasse qu'au-dessus et à gauche, comme sur la maquette. */}
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 aspect-[670/377] w-[68cqw] bg-[url(/brand/motif-bleu-section.webp)] bg-cover bg-no-repeat"
        />

        {/* Le bloc du conteneur et de son « GO → » : décalé de 7,5cqw, il prend la largeur de ses
            photos (`w-fit`) jusqu'au bord de la colonne (`max-w`), et le « GO » s'aligne sur SON
            bord droit — avec deux photos, il reste sous le conteneur au lieu de partir au bout de
            la colonne. `relative` : passe au-dessus du motif, positionné avant lui. */}
        <div className="relative ml-[7.5cqw] w-fit max-w-[92.5cqw]">
          {/* LE CONTENEUR MARINE (`--accent-foreground` : le marine de la charte, couple du logo
              avec l'or de la page). */}
          <div className="rounded-[1.4cqw] bg-[var(--accent-foreground)] p-[2.6cqw]">
            <ul className="flex snap-x snap-mandatory gap-[1.9cqw] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tarjetas.map((tarjeta) => (
                // `clave` : la clé vient de la donnée, jamais de l'index (spec 28 §0).
                <Tesela key={tarjeta.clave} oferta={tarjeta} />
              ))}
            </ul>
          </div>

          {/* « GO → » : le lien vers la page du type, aligné sur le bord droit du conteneur. Le « GO »
              est celui du LOGO (glyphes de la charte, recomposés en ligne : `go.webp`), la flèche est
              au bleu poudre. Nom accessible : « GO » (le texte qu'on voit, WCAG 2.5.3) puis le libellé
              complet, « GO Más actividades » — c'est aussi le texte d'ancre que lit un moteur.
              ⚠️ Le `Link` de `@/i18n/navigation` : lui seul conserve le préfixe de langue. */}
          {mostrarVerMas ? (
            <div className="mt-[2.4cqw] flex justify-end">
              <Link
                href={hrefVerMas}
                className="group/go -mr-1 inline-flex min-h-11 items-center gap-[1.4cqw] rounded-full p-1 focus-visible:status-focused"
                data-testid={testId ? `${testId}-ver-mas` : undefined}
              >
                <NextImage
                  src="/brand/go.webp"
                  alt="GO"
                  width={214}
                  height={116}
                  className="h-[clamp(1.75rem,5.1cqw,3.25rem)] w-auto transition-transform duration-200 group-hover/go:scale-105 motion-reduce:transition-none"
                />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 40 24"
                  fill="none"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-[clamp(1.1rem,3.6cqw,2.25rem)] w-auto stroke-[var(--default)] transition-transform duration-200 group-hover/go:translate-x-1 motion-reduce:transition-none"
                >
                  <path d="M3 12h32M25 3l10 9-10 9" />
                </svg>
                <span className="sr-only">{labelVerMas}</span>
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
