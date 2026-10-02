import NextImage from "next/image";
import { Price } from "@/components/atoms/Price";
import { Link } from "@/i18n/navigation";
import type { TarjetaOferta } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";
import { FilaPortada } from "./FilaPortada";

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
// TROIS PHOTOS À L'ÉCRAN (UNE SUR MOBILE), HUIT DANS LE DOM — et pourquoi pas trois tout court
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La maquette montre trois photos. La page en sert jusqu'à huit (`POR_SECCION`, cahier §2a), et les
// e2e (`e2e/home.spec.ts`) cliquent des offres NOMMÉES qui ne sont pas forcément dans les trois
// premières. La rangée défile donc DANS le conteneur, trois photos exactement à l'écran : au repos,
// c'est la maquette ; au doigt, au trackpad ou à la tabulation, les cinq autres viennent. Sous `md`,
// UNE seule photo à l'écran (Jérôme, 2026-10-02 : « juste une seule carte ») — voir `CLASE_TESELA`.
// La barre
// de défilement est masquée — la maquette n'en a pas, et « GO → » mène de toute façon à la liste
// complète. Pas de `tabIndex`/`role="region"` sur la rangée : elle ne contient que des liens, donc
// elle est déjà atteignable au clavier (`.claude/rules/ui.md`).
//
// ⚠️ PAS DE "use client" : aucune donnée de navigateur, aucun état. Le HTML des cinq sections est
// SERVI — c'est lui que Google indexe, et c'est le contenu principal de la page. La seule exception
// (2026-10-02) est la rangée elle-même, `FilaPortada` : ses voiles flous de bord doivent savoir
// s'il reste des photos à faire défiler. Les tuiles lui arrivent en `children`, déjà rendues ici.
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
  /** Formate le prix des bulles (`Price`). */
  locale: Locale;
  /** Déjà traduit (« Desde ») — la section ne traduit rien, la page le lui passe. */
  labelDesde: string;
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
// plafonne alors à 82,4 + 2 × 1,3 = 85cqw sous `md` (`CLASE_BLOQUE`) : une photo pile, les sept
// autres viennent au doigt, une par une (`snap-mandatory` de `FilaPortada`).
// Sous `md`, décalage, marge intérieure, ce plafond et cette largeur bougent ENSEMBLE — un test
// refait le calcul.
//
// ⚠️ `@container` : la tuile est SON PROPRE conteneur de requête, et tout ce qu'elle contient
// (arrondi, marges, cartouche, bulles, texte) est en `cqw` DE LA TUILE, pas de la section. C'est ce
// qui lui permet de passer de 28,69 à 82,39cqw de section sans qu'aucune de ses mesures intérieures
// ne change de proportion. Les valeurs de la tuile sont celles de la maquette (en cqw de section)
// multipliées par 100 / 28,69 : au-dessus de `md`, le rendu est inchangé au centième près.
// Le `<li>` ne peut pas s'interroger lui-même — sa largeur se résout donc toujours sur la section.
const CLASE_TESELA = "@container w-[82.39cqw] shrink-0 snap-start md:w-[28.69cqw]";

// Le bloc du conteneur et de son « GO → » (voir son commentaire dans le rendu). Chaîne littérale
// complète, comme les autres : Tailwind v4 ne génère pas une classe fabriquée par interpolation.
const CLASE_BLOQUE = "relative ml-[7.5cqw] w-fit max-w-[85cqw] md:max-w-[92.5cqw]";

// `sizes` suit `CLASE_TESELA`, mesuré au rendu le 2026-10-02 : 275 px quand la colonne est à son
// plafond (`max-w-5xl` gouttières comprises, donc 960 px de contenu dès 1 024 px d'écran), entre 26
// et 27 % de l'écran de `md` à 1 024 (202 px à 768), et sous `md` la photo seule — 74 % de l'écran
// à 390 (288 px), 78 % au pire juste sous 640 (gouttière `px-5`).
const SIZES_TESELA = "(min-width: 1024px) 276px, (min-width: 768px) 27vw, 78vw";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA TUILE — cartouche + bulles, d'après la référence de Jérôme du 2026-10-02
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// « Je veux que mes cartes avec photo soient présentées comme celle-ci » (carte « La Comète
// Argentique ») : le nom n'attend plus le survol, il est dans un CARTOUCHE au blanc légèrement
// bleuté de la charte (`--background`), en bas de la photo, avec l'établissement dessous ; les
// informations utiles (le prix) sont des BULLES blanches cerclées juste au-dessus, à droite. Même
// allure que `Card layout="overlay"` (cartes des listings), réécrite ici et non importée : `Card`
// tire le barrel du design system, interdit dans ce Server Component (dernier test du fichier).
//
// ⚠️ LE LIEN EST LE TITRE, ÉTIRÉ — le motif « stretched link » de `Card`, pour la même raison : si le
// lien ENVELOPPAIT le cartouche et les bulles, son nom accessible deviendrait « Kayak Casa Kayam
// 95.000 COP » au lieu du nom de l'offre. Ici seul le nom est dans le `<a>` ; son `::after` couvre
// toute la tuile, photo comprise.
//   · Le calque de texte est un élément de GRILLE avec `z-[1]` et SANS position : il passe au-dessus
//     de la photo (positionnée par `fill`) sans devenir le bloc conteneur du `::after`, qui se
//     résout donc sur la tuile (`relative`). Un calque `absolute` réduirait la zone cliquable au
//     seul calque.
//   · Le focus : un anneau OR intérieur sur ce `::after` — le bleu de `--focus` ne se verrait pas
//     sur le marine du conteneur, et un anneau extérieur serait rogné par la rangée qui défile.
//
// ⚠️ Les BULLES en blanc et noir nus, et le voile `bg-black/55` : posées sur une photo, leur
// contraste ne dépend pas du thème — calcul au pire cas (photo blanche) dans l'en-tête
// d'`OVERLAY_BULLES_CLASS`, `components/atoms/Card.tsx`. Les deux doivent rester d'accord.
//
// Les tailles de texte sont en `cqw` DE LA TUILE (voir `CLASE_TESELA`), bornées : une tuile fait
// 288 px sur un écran de 390 et 275 px à 1 280 — le texte y est donc à peu près le même.
const CLASE_BULLE =
  "rounded-full border-[1.5px] border-white bg-black/55 px-[3.14cqw] py-[0.87cqw] text-[clamp(0.625rem,4.01cqw,0.8125rem)] font-bold uppercase leading-tight text-white backdrop-blur-sm";

function Tesela({
  oferta,
  locale,
  labelDesde,
}: {
  oferta: TarjetaOferta;
  locale: Locale;
  labelDesde: string;
}) {
  // La PREMIÈRE photo seulement : la maquette montre une image par offre, pas un carrousel dans une
  // vignette de 100 px.
  const foto = oferta.fotos[0]?.url ?? null;

  // Même règle que `TarjetaOferta` pour les quatre formes du prix : `texto` tel quel, JAMAIS
  // formaté en COP ; `null` → AUCUNE bulle, jamais « 0 COP ».
  const { precio } = oferta;
  const bullePrecio =
    precio?.tipo === "monto" ? (
      <Price amountCop={precio.cop} locale={locale} />
    ) : precio?.tipo === "desde" ? (
      <>
        {labelDesde} <Price amountCop={precio.cop} locale={locale} />
      </>
    ) : precio?.tipo === "texto" ? (
      precio.label
    ) : null;

  // L'établissement seul en sous-titre. Une carte GROUPÉE n'en a pas (`establecimiento = null`) et
  // porte à la place un décompte de couchages — que `TarjetaOferta` affiche, mais qui demande un
  // libellé pluriel traduit que cette section ne reçoit pas : elle n'a alors que son nom.
  const sousTitre = oferta.establecimiento;

  return (
    <li className={CLASE_TESELA}>
      <div
        className="group relative grid aspect-[20/21] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[8.37cqw] bg-[var(--default)]"
        data-testid={oferta.testId}
      >
        {foto ? (
          // `alt=""` : le lien de la tuile porte déjà le nom de l'offre — une description de la
          // photo le répéterait (« Kayak en el embalse, foto 1 de 3 », lu deux fois).
          <NextImage
            src={foto}
            alt=""
            fill
            sizes={SIZES_TESELA}
            className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none"
          />
        ) : null}
        <div className="z-[1] col-start-1 row-start-1 flex min-w-0 flex-col items-end justify-end gap-[2.79cqw] p-[4.18cqw]">
          {bullePrecio !== null ? (
            <span className={CLASE_BULLE} data-testid={`${oferta.testId}-precio`}>
              {bullePrecio}
            </span>
          ) : null}
          <div className="w-full rounded-[4.88cqw] bg-[var(--background)] px-[4.18cqw] py-[3.14cqw] text-center leading-tight text-[var(--foreground)]">
            <Link
              href={oferta.href}
              className="line-clamp-2 text-[clamp(0.6875rem,5.23cqw,1rem)] font-bold uppercase focus-visible:outline-none after:absolute after:inset-0 after:z-[1] after:content-[''] focus-visible:after:ring-4 focus-visible:after:ring-inset focus-visible:after:ring-[var(--accent)]"
              data-testid={`${oferta.testId}-link`}
            >
              {oferta.nombre}
            </Link>
            {sousTitre ? (
              <p className="mt-[0.7cqw] line-clamp-1 text-[clamp(0.625rem,4.18cqw,0.8125rem)] font-medium">
                {sousTitre}
              </p>
            ) : null}
          </div>
        </div>
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
  locale,
  labelDesde,
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
            n'en dépasse qu'au-dessus et à gauche, comme sur la maquette.
            ⚠️ BORD BAS REMONTÉ DE 18 PX le 2026-10-02 (Jérôme, 10 puis 5 puis 3), haut et largeur
            inchangés : la hauteur est celle du ratio de l'asset (68cqw × 377/670) MOINS 18 px, au lieu de
            `aspect-[670/377]`. `bg-cover` garde alors l'échelle dictée par la largeur et rogne le
            bas de l'image — le motif ne se tasse pas, il est coupé plus haut.
            Puis l'IMAGE remonte de 7 px DANS ce cadre (`background-position: 0 -7px`, même jour) :
            le cadre ne bouge pas, le haut du motif est rogné de 7 px et son bas en regagne autant
            (il en restait 18 de réserve). */}
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 h-[calc(68cqw*377/670_-_18px)] w-[68cqw] bg-[url(/brand/motif-bleu-section.webp)] bg-cover bg-no-repeat [background-position:0_-7px]"
        />

        {/* Le bloc du conteneur et de son « GO → » : décalé de 7,5cqw, il prend la largeur de ses
            photos (`w-fit`) jusqu'au bord de la colonne (`max-w`), et le « GO » s'aligne sur SON
            bord droit — avec deux photos, il reste sous le conteneur au lieu de partir au bout de
            la colonne. `relative` : passe au-dessus du motif, positionné avant lui. Plafond à 85cqw
            sous `md` : la photo seule y est centrée à l'écran (`CLASE_TESELA`). */}
        <div className={CLASE_BLOQUE}>
          {/* LE CONTENEUR MARINE (`--accent-foreground` : le marine de la charte, couple du logo
              avec l'or de la page). Son arrondi fait 58 % de celui des tuiles (1,4 / 2,4cqw sur la
              maquette) : sous `md`, où la photo seule s'arrondit à 6,9cqw de section (8,37cqw de
              tuile × 82,39 %), le garder à 1,4cqw laissait des coins marine anguleux autour d'elle (vu
              au rendu, 5 px contre 26) — d'où 4,02cqw, la même proportion. */}
          <div className="rounded-[4.02cqw] bg-[var(--accent-foreground)] p-[1.3cqw] md:rounded-[1.4cqw]">
            {/* La rangée et ses voiles flous de bord : seule partie client de la section, voir
                `FilaPortada.tsx`. Les tuiles restent rendues ICI, côté serveur. */}
            <FilaPortada testId={testId ? `${testId}-fila` : undefined}>
              {tarjetas.map((tarjeta) => (
                // `clave` : la clé vient de la donnée, jamais de l'index (spec 28 §0).
                <Tesela key={tarjeta.clave} oferta={tarjeta} locale={locale} labelDesde={labelDesde} />
              ))}
            </FilaPortada>
          </div>

          {/* « GO → » : le lien vers la page du type, aligné sur le bord droit du conteneur. Le « GO »
              est celui du LOGO (glyphes de la charte, recomposés en ligne : `go.webp`), la flèche est
              au bleu poudre. Nom accessible : « GO » (le texte qu'on voit, WCAG 2.5.3) puis le libellé
              complet, « GO Más actividades » — c'est aussi le texte d'ancre que lit un moteur.
              ⚠️ Le `Link` de `@/i18n/navigation` : lui seul conserve le préfixe de langue.
              ⚠️ SOUS `md`, LA POINTE DE LA FLÈCHE TOMBE SUR LE BORD DROIT DE LA PHOTO, pas du conteneur
              (Jérôme, 2026-10-02) : retrait de la marge intérieure (1,3cqw) MOINS le vide que la
              pointe laisse dans son propre `<svg>` — elle finit à x = 35 + 4,5 / 2 = 37,25 sur 40,
              soit 2,75 / 24 de la hauteur du `<svg>` (ratio 40 × 24), dont le `clamp` est repris tel
              quel. Le `-mr-1` du lien annule son `p-1` : le bord du `<svg>` est celui de ce bloc. */}
          {mostrarVerMas ? (
            <div className="mt-[2.4cqw] flex justify-end pr-[calc(1.3cqw_-_clamp(1.1rem,3.6cqw,2.25rem)*2.75/24)] md:pr-0">
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
