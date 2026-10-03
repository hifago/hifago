import { EnlaceGo } from "@/components/atoms/EnlaceGo";
import { FilaRiel } from "@/components/molecules/FilaRiel";
import { TeselaOferta } from "@/components/molecules/TeselaOferta";
import { TituloRubrica } from "@/components/molecules/TituloRubrica";
import type { TarjetaOferta } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";

// LE RAIL — une rangée d'offres telle que la dessine la maquette de l'accueil de Jérôme
// (2026-10-01) :
//
//     Actividades●                       ← titre à point (`TituloRubrica`, S1)
//     ──────────────────────             ← trait sur 68 % de la colonne
//     ░░░░░░░░░░░░░░░░░░░░░░             ← le motif de la charte (asset fourni), derrière…
//     ░░░ ┌──────────────────────────┐   ← …le conteneur MARINE, décalé de 7,5 % vers la droite
//     ░░░ │ [photo] [photo] [photo]  │   ← tuiles `TeselaOferta` (S4)
//         └──────────────────────────┘
//                                GO →    ← `EnlaceGo` (S5), vers la page « voir tout »
//
// Né `SeccionPortada`, à côté de la page d'accueil ; déplacé ici et paramétré par le plan 41, item
// S3 (2026-10-02 ; arbitrage D7 = A) : « une rangée d'offres est un rail » — l'accueil, l'index par
// type (P1) et la fiche établissement (P4) le rendent. Ce qui varie :
//   - `tamanoTitulo` : `portada` (l'accueil, 28 → 60 px) ou `seccion` (une rubrique de page) ;
//   - `motivo` : le motif bleu derrière le conteneur (vrai par défaut) ;
//   - le « GO → », absent quand il n'y a pas de page « voir tout » (une fiche établissement) ;
//   - `prioridad` : la première tuile porte le LCP — jamais sur l'accueil, dont le LCP est
//     l'illustration du héros ;
//   - `minimosTexto` : les planchers de texte des tuiles (S4), que l'accueil désactive pour l'instant.
//
// ⚠️ PAS UNE VARIANTE DE `SeccionOfertas`. Cette dernière servait les bandes défilantes des index
// par type ; P1 (2026-10-03) les a remplacées par ce rail, et elle n'a plus d'appelant (G5).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// TOUT EST EN `cqw` — les proportions de la maquette, mesurées au pixel, à toute largeur
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La section est un conteneur de requête (`@container`) : `1cqw` = 1 % de SA largeur, qui est celle
// de la colonne. Chaque écart ci-dessous est une mesure de la maquette (colonne de 572 px) divisée
// par cette largeur — 43 px de décalage du conteneur = 7,5cqw, 15 px de marge intérieure = 2,6cqw…
// La maquette se retrouve donc à l'identique à 390 comme à 1 280 px, au lieu d'être juste à une
// seule largeur, et dans N'IMPORTE QUELLE colonne. Seules les tailles de TEXTE sont bornées
// (`clamp`), pour rester lisibles.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// TROIS PHOTOS À L'ÉCRAN (UNE SUR MOBILE), HUIT DANS LE DOM — et pourquoi pas trois tout court
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La maquette montre trois photos. L'accueil en sert jusqu'à huit (`POR_SECCION`, cahier §2a), et
// les e2e (`e2e/home.spec.ts`) cliquent des offres NOMMÉES qui ne sont pas forcément dans les trois
// premières. La rangée défile donc DANS le conteneur, trois photos exactement à l'écran : au repos,
// c'est la maquette ; au doigt, au trackpad ou à la tabulation, les autres viennent. Sous `md`, UNE
// seule photo à l'écran (Jérôme, 2026-10-02 : « juste une seule carte ») — voir `CLASE_TESELA`.
// La barre de défilement est masquée — la maquette n'en a pas, et « GO → » mène à la liste
// complète. Pas de `tabIndex`/`role="region"` sur la rangée : elle ne contient que des liens, donc
// elle est déjà atteignable au clavier (`.claude/rules/ui.md`).
//
// ⚠️ PAS DE "use client" : aucune donnée de navigateur, aucun état. Le HTML des tuiles est SERVI —
// c'est lui que Google indexe. La seule exception (2026-10-02) est la rangée elle-même, `FilaRiel` :
// ses voiles flous de bord doivent savoir s'il reste des photos à faire défiler. Les tuiles lui
// arrivent en `children`, déjà rendues ici.
export type SeccionRielProps = {
  /** Déjà traduit — c'est aussi le nom accessible de la section. */
  titulo: string;
  /** `portada` : les titres de l'accueil (28 → 60 px) ; `seccion` : une rubrique de page. */
  tamanoTitulo: "portada" | "seccion";
  /** Page « voir tout », critères de recherche déjà inclus. Sans elle, pas de « GO → ». */
  hrefVerMas?: string;
  /** Déjà traduit (« Más actividades »). Nom accessible du « GO → », que l'œil lit « GO ». */
  labelVerMas?: string;
  /** Faux pour taire le « GO → » (une recherche qui ne laisse rien de plus à voir). */
  mostrarVerMas?: boolean;
  tarjetas: TarjetaOferta[];
  /** Formate le prix des bulles. */
  locale: Locale;
  /** Déjà traduit (« Desde ») — la section ne traduit rien, la page le lui passe. */
  labelDesde: string;
  /**
   * Le sous-titre d'une carte GROUPÉE (« 3 alojamientos »), déjà traduit, par nombre. Une fonction
   * et non une chaîne : le pluriel dépend de chaque tuile. Elle passe d'un composant serveur à un
   * autre, donc rien n'est sérialisé. Absente, une carte groupée n'a pas de sous-titre (l'accueil,
   * qui doit rester identique au pixel).
   */
  conteoAlojamientos?: (n: number) => string;
  /** La bulle de capacité (« Hasta 2 personas »), déjà traduite, par nombre. Même raison. */
  capacidadPersonas?: (n: number) => string;
  /** La première tuile porte `priority` (le LCP de la page). Jamais sur l'accueil. */
  prioridad?: boolean;
  /** Le motif bleu derrière le conteneur. Vrai par défaut. */
  motivo?: boolean;
  /** Planchers de texte des tuiles (S4). Vrai par défaut ; l'accueil les désactive (`TeselaOferta`). */
  minimosTexto?: boolean;
  testId?: string;
};

// La largeur d'une photo n'est pas une valeur choisie — c'est le TIERS de l'intérieur du conteneur
// plein (plafond − 2 × marge intérieure − 2 × 1,9cqw de gouttière, chiffres ci-dessous), donc
// exactement trois photos à l'écran. En `cqw` et non en `%` du conteneur, et c'est ce qui permet
// au conteneur d'ÉPOUSER ses photos quand il y en a moins de trois (`w-fit`) : un pourcentage de sa
// largeur serait circulaire. Demande de Jérôme du 2026-10-01, sur la version précédente : « il ne
// doit pas être rectangulaire » — deux photos ne laissent pas un tiers de marine vide.
//
// ⚠️ LISERÉ MARINE DIVISÉ PAR DEUX LE 2026-10-02 (Jérôme : « réduis de moitié le contour bleu autour
// des cartes »). La marge intérieure passe de 2,6 à 1,3cqw. Le conteneur, lui, GARDE sa taille
// d'origine (décalage 7,5cqw, plafond 92,5cqw) : un premier essai le resserrait aussi de 0,65cqw
// par côté, Jérôme l'a fait remettre le même jour. Tout l'espace libéré va donc aux photos, au
// tiers du nouvel intérieur : 92,5 − 2 × 1,3 − 2 × 1,9 = 86,1cqw, soit 28,7cqw, arrondi À LA BAISSE
// à 28,69 (trois photos au tiers exact frôlent le plafond, et un arrondi de navigateur rendrait la
// rangée défilable de quelques dixièmes de pixel).
// Ces trois nombres (décalage, plafond, marge intérieure) et celui-ci bougent ENSEMBLE.
//
// ⚠️ UNE SEULE PHOTO SOUS `md`, CENTRÉE À L'ÉCRAN (Jérôme, 2026-10-02, sur l'accueil mobile : « je
// ne veux pas trois cartes, juste une seule ; le carrousel garde le reste », puis « réduis la carte
// pour qu'elle apparaisse centrée, sans la bouger »). Trois tiers d'une colonne de 350 px faisaient
// des vignettes de 100 px, nom en 11 px. Le bord GAUCHE de la photo ne bouge pas — décalage du
// conteneur + marge intérieure = 7,5 + 1,3 = 8,8cqw — et le bord droit s'arrête à la même distance
// du bord de colonne, donc de l'écran (les gouttières de `COLUMNA_PORTADA` sont symétriques) :
// 100 − 2 × 8,8 = 82,4cqw, arrondi à la baisse à 82,39 pour la même raison qu'au-dessus. Le conteneur
// plafonne alors à 82,4 + 2 × 1,3 = 85cqw sous `md` (`CLASE_BLOQUE`) : une photo pile, les autres
// viennent au doigt, une par une (`snap-mandatory` de `FilaRiel`).
// Sous `md`, décalage, marge intérieure, ce plafond et cette largeur bougent ENSEMBLE — un test
// refait le calcul.
//
// La tuile (`TeselaOferta`) est SON PROPRE conteneur de requête : son intérieur est en `cqw` DE LA
// TUILE, et passe de 28,69 à 82,39cqw de section sans changer de proportion. Le `<li>` ne fait que
// la dimensionner ; sa largeur se résout sur la section.
const CLASE_TESELA = "w-[82.39cqw] shrink-0 snap-start md:w-[28.69cqw]";

// Le bloc du conteneur et de son « GO → » (voir son commentaire dans le rendu). Chaîne littérale
// complète, comme les autres : Tailwind v4 ne génère pas une classe fabriquée par interpolation.
const CLASE_BLOQUE = "relative ml-[7.5cqw] w-fit max-w-[85cqw] md:max-w-[92.5cqw]";

// `sizes` suit `CLASE_TESELA`, mesuré au rendu le 2026-10-02 : 275 px quand la colonne est à son
// plafond (`max-w-5xl` gouttières comprises, donc 960 px de contenu dès 1 024 px d'écran), entre 26
// et 27 % de l'écran de `md` à 1 024 (202 px à 768), et sous `md` la photo seule — 74 % de l'écran
// à 390 (288 px), 78 % au pire juste sous 640 (gouttière `px-5`). ⚠️ Vrai dans la colonne de
// l'accueil (`COLUMNA_PORTADA`, la colonne de tout le site depuis F7) ; une colonne plus étroite
// surestimerait la photo, jamais l'inverse.
const SIZES_TESELA = "(min-width: 1024px) 276px, (min-width: 768px) 27vw, 78vw";

export function SeccionRiel({
  titulo,
  tamanoTitulo,
  hrefVerMas,
  labelVerMas,
  mostrarVerMas = true,
  tarjetas,
  locale,
  labelDesde,
  conteoAlojamientos,
  capacidadPersonas,
  prioridad = false,
  motivo = true,
  minimosTexto = true,
  testId,
}: SeccionRielProps) {
  return (
    // `aria-label` : une <section> sans nom n'est pas un repère de navigation. Le nom est le titre
    // visible, jamais un libellé parallèle qui divergerait.
    <section aria-label={titulo} className="@container" data-testid={testId}>
      {/* Le titre à point et son trait (68 % de la colonne, comme le motif qu'il surmonte). En
          `portada`, 6,3 % de la colonne, comme la maquette — borné à 28 px et à 60 px (la taille
          que Jérôme a retenue pour les titres de l'accueil le 2026-10-01). Point et trait : ceux
          de la surface (bleu poudre et marine sur l'or). */}
      <TituloRubrica
        as="h2"
        texto={titulo}
        tamano={tamanoTitulo}
        testId={testId ? `${testId}-titulo` : undefined}
      />

      {/* `pt-[6.3cqw]` et non une marge sur le conteneur : une marge haute sur le premier enfant
          FUSIONNE avec celle de ce bloc (constaté au rendu — le motif démarrait au niveau du
          conteneur au lieu de le dépasser au-dessus). Un padding ne fusionne pas. Sans motif, il
          n'y a plus rien à laisser dépasser : 2,4cqw, l'écart du conteneur au « GO » (vu au rendu,
          6,3cqw y laissaient une bande vide de 60 px). */}
      <div className={motivo ? "relative mt-[1.4cqw] pt-[6.3cqw]" : "relative mt-[1.4cqw] pt-[2.4cqw]"}>
        {/* LE MOTIF — l'asset fourni par Jérôme (`motif-bleu-section.webp`, son bleu `#3c90d4` tel
            quel : c'est celui de la maquette), à la largeur du trait et à ses proportions. En fond
            CSS : purement décoratif, aucun `<img>` à annoncer. Le conteneur marine le recouvre ; il
            n'en dépasse qu'au-dessus et à gauche, comme sur la maquette. Jamais répété en
            mosaïque (bords non raccordables, plan 41 §3.7).
            ⚠️ BORD BAS REMONTÉ DE 18 PX le 2026-10-02 (Jérôme, 10 puis 5 puis 3), haut et largeur
            inchangés : la hauteur est celle du ratio de l'asset (68cqw × 377/670) MOINS 18 px, au lieu de
            `aspect-[670/377]`. `bg-cover` garde alors l'échelle dictée par la largeur et rogne le
            bas de l'image — le motif ne se tasse pas, il est coupé plus haut.
            Puis l'IMAGE remonte de 7 px DANS ce cadre (`background-position: 0 -7px`, même jour) :
            le cadre ne bouge pas, le haut du motif est rogné de 7 px et son bas en regagne autant
            (il en restait 18 de réserve). */}
        {motivo ? (
          <div
            aria-hidden="true"
            className="absolute left-0 top-0 h-[calc(68cqw*377/670_-_18px)] w-[68cqw] bg-[url(/brand/motif-bleu-section.webp)] bg-cover bg-no-repeat [background-position:0_-7px]"
          />
        ) : null}

        {/* Le bloc du conteneur et de son « GO → » : décalé de 7,5cqw, il prend la largeur de ses
            photos (`w-fit`) jusqu'au bord de la colonne (`max-w`), et le « GO » s'aligne sur SON
            bord droit — avec deux photos, il reste sous le conteneur au lieu de partir au bout de
            la colonne. `relative` : passe au-dessus du motif, positionné avant lui. Plafond à 85cqw
            sous `md` : la photo seule y est centrée à l'écran (`CLASE_TESELA`). */}
        <div className={CLASE_BLOQUE}>
          {/* LE CONTENEUR MARINE (`--accent-foreground` : le marine de la charte). Il reste marine
              sur toutes les surfaces, or comme clair (§3.6 du plan). Son arrondi a été fixé à 58 %
              de celui des tuiles d'ALORS (1,4 / 2,4cqw sur la maquette) : sous `md`, où la photo
              seule s'arrondissait à 6,9cqw de section, le garder à 1,4cqw laissait des coins marine
              anguleux autour d'elle (vu au rendu, 5 px contre 26) — d'où 4,02cqw, la même proportion.
              ⚠️ Depuis les tuiles carrées à 16 px (2026-10-02), ce rapport ne tient plus (≈ 13-14 px
              contre 16) et l'arrondi n'a PAS été recalculé : « le reste ne change pas » (Jérôme). */}
          <div className="rounded-[4.02cqw] bg-[var(--accent-foreground)] p-[1.3cqw] md:rounded-[1.4cqw]">
            {/* La rangée et ses voiles flous de bord : seule partie client de la section, voir
                `FilaRiel.tsx`. Les tuiles restent rendues ICI, côté serveur. */}
            <FilaRiel testId={testId ? `${testId}-fila` : undefined}>
              {tarjetas.map((tarjeta, indice) => (
                // `clave` : la clé vient de la donnée, jamais de l'index (spec 28 §0).
                <li key={tarjeta.clave} className={CLASE_TESELA}>
                  <TeselaOferta
                    oferta={tarjeta}
                    locale={locale}
                    labelDesde={labelDesde}
                    labelConteo={
                      tarjeta.nAlojamientos !== null ? conteoAlojamientos?.(tarjeta.nAlojamientos) : undefined
                    }
                    labelCapacidad={
                      tarjeta.capacidad !== null ? capacidadPersonas?.(tarjeta.capacidad) : undefined
                    }
                    sizes={SIZES_TESELA}
                    // UNE seule tuile prioritaire, la première : les autres sont hors de l'écran.
                    prioridad={prioridad && indice === 0}
                    minimosTexto={minimosTexto}
                  />
                </li>
              ))}
            </FilaRiel>
          </div>

          {/* « GO → » vers la page « voir tout », aligné sur le bord droit du conteneur (S5).
              ⚠️ SOUS `md`, LA POINTE DE LA FLÈCHE TOMBE SUR LE BORD DROIT DE LA PHOTO, pas du conteneur
              (Jérôme, 2026-10-02) : retrait de la marge intérieure (1,3cqw) MOINS le vide que la
              pointe laisse dans son propre `<svg>` — elle finit à x = 35 + 4,5 / 2 = 37,25 sur 40,
              soit 2,75 / 24 de la hauteur du `<svg>` (ratio 40 × 24), dont le `clamp` est repris tel
              quel de `EnlaceGo`. Le bord du `<svg>` est celui de ce bloc (`-mr-1` de `EnlaceGo`). */}
          {mostrarVerMas && hrefVerMas !== undefined && labelVerMas !== undefined ? (
            <div className="mt-[2.4cqw] flex justify-end pr-[calc(1.3cqw_-_clamp(1.1rem,3.6cqw,2.25rem)*2.75/24)] md:pr-0">
              <EnlaceGo
                href={hrefVerMas}
                label={labelVerMas}
                tamano="portada"
                testId={testId ? `${testId}-ver-mas` : undefined}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
