import NextImage from "next/image";
import type { ReactNode } from "react";
import { Price } from "@/components/atoms/Price";
import { Link } from "@/i18n/navigation";
import type { TarjetaOferta } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";

// LA tuile photo de la vitrine : plan 41, item S4 (docs/specs/41-charte-hifago-toute-la-vitrine.md,
// 2026-10-02 ; arbitrage D6 = A, une seule photo). C'est la `Tesela` de l'accueil, extraite : deux
// cartes photo coexistaient (constat T10) — celle de l'accueil et `Card layout="overlay"` des
// listings, différentes par l'arrondi (16 contre 8 px), la police du nom (Poppins contre la police
// de titre en faux gras), le nombre de lignes, les bulles et le carrousel. Il n'en reste qu'une.
//
//     ┌──────────────────────┐
//     │        [photo]       │  ← carrée, arrondie à 16 px, zoom doux au survol
//     │        ( 95.000 COP )│  ← bulles blanches cerclées : une par information présente
//     │ ┌──────────────────┐ │
//     │ │  KAYAK EN EL …   │ │  ← cartouche : nom (lien étiré), établissement ou décompte dessous
//     │ └──────────────────┘ │
//     └──────────────────────┘
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUI EST FIXE, CE QUI EST PROPORTIONNEL
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La tuile est SON PROPRE conteneur de requête (`@container`) : tout son intérieur (marges,
// cartouche, bulles, texte) est en `cqw` DE LA TUILE, donc proportionnel à sa largeur — 202 à
// 288 px dans un rail, jusqu'à 300 px et plus dans une grille. Les valeurs sont celles de la
// maquette de l'accueil. Deux exceptions :
//   - L'ARRONDI : 16 px fixes, dans tous les contextes (Jérôme, 2026-10-02). Ni `rounded-2xl`, que
//     le thème vitrine calcule à 8 px (2 × `--radius`, mesuré), ni des `cqw`, qui varieraient d'une
//     grille à un rail. Les voiles de bord d'un rail recouvrent cet arrondi : même valeur ;
//   - LES PLANCHERS DE TEXTE (item S4 du plan) : nom ≥ 13 px, établissement ≥ 12 px, bulles
//     ≥ 11 px (bornes basses des `clamp`). Sans eux, une tuile de 202 px (rail à 768 px d'écran)
//     écrivait le nom à 11 px et l'établissement à 10.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE LIEN EST LE NOM, ÉTIRÉ — et la photo est décorative
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Motif « stretched link » : seul le nom est dans le `<a>`, et son `::after` couvre toute la tuile.
// Si le lien ENVELOPPAIT le cartouche et les bulles, son nom accessible deviendrait « Kayak Casa
// Kayam 95.000 COP ».
//   · Le calque de texte est un élément de GRILLE avec `z-[1]` et SANS position : il passe au-dessus
//     de la photo (positionnée par `fill`) sans devenir le bloc conteneur du `::after`, qui se
//     résout donc sur la tuile (`relative`). Un calque `absolute` réduirait la zone cliquable au
//     seul calque.
//   · Le focus : un anneau OR intérieur sur ce `::after` — le bleu de `--focus` ne se verrait pas
//     sur le marine d'un rail, et un anneau extérieur serait rogné par une rangée qui défile.
//   · Photo `alt=""` : le lien porte déjà le nom de l'offre, une description le répéterait. C'est la
//     décision prise sur l'accueil ; le texte « <nom>, foto i de n » des anciennes cartes de
//     listing disparaît avec leur carrousel (D6 = A).
//   · PAS DE TITRE HTML : le nom est un lien dans une liste (`<li>` de l'appelant), comme sur
//     l'accueil. L'ancien `<h3>` des cartes de listing était en police de titre à 18 px et en faux
//     gras (F2), et sautait un niveau sous le `<h1>` d'une page de catégorie.
//
// ⚠️ Les BULLES en blanc et noir nus, et le voile `bg-black/55` : posées sur une photo, leur
// contraste ne dépend pas du thème — calcul au pire cas (photo blanche) dans l'en-tête
// d'`OVERLAY_BULLES_CLASS`, `components/atoms/Card.tsx` : 4,74:1.
//
// ⚠️ `next/image` directement, et pas l'atome `Image` : la photo doit zoomer au survol de la tuile
// (`group-hover`) et occuper la cellule de grille sans enveloppe positionnée, et une tuile sans
// photo garde le fond bleu poudre de l'accueil, pas le substitut de l'atome. Mêmes garanties
// qu'avec lui : `alt`, `sizes` et `loading` sont posés ici, jamais oubliés.
//
// ⚠️ Composant serveur : ni `"use client"`, ni le barrel du design system (CLAUDE.md §11.16). Il
// reçoit ses libellés DÉJÀ TRADUITS (`.claude/rules/apps.md`, frontière RSC). Il reste rendable
// dans un composant client (la grille de `ListadoInfinito` charge ses pages au navigateur), mais
// ne doit pas y être enfermé sans raison : là où une page serveur le rend, il y reste.
export type TeselaOfertaProps = {
  oferta: TarjetaOferta;
  /** Formate le prix des bulles (`Price`). */
  locale: Locale;
  /** Déjà traduit (« Desde ») : préfixe d'un prix `desde`. */
  labelDesde: string;
  /** Déjà traduit (« Hasta 2 personas ») : bulle de capacité, sur les seules cartes qui la portent. */
  labelCapacidad?: string;
  /** Déjà traduit (« 3 alojamientos ») : sous-titre d'une carte GROUPÉE, qui n'a pas d'établissement. */
  labelConteo?: string;
  /** La largeur réelle de la tuile dans SON contexte (rail, grille) : l'appelant seul la connaît. */
  sizes: string;
  /** UNE SEULE tuile de la page : la première photo de contenu, quand elle est le LCP. */
  prioridad?: boolean;
  /**
   * Les planchers de texte de S4 (nom 13 px, établissement 12, bulles 11). Vrai par défaut. Faux sur
   * l'ACCUEIL seulement, et provisoirement : ses tailles ont été validées au pixel par Jérôme, et les
   * planchers les changeraient à 360 et 768 px — à lui de trancher (plan 41, S3).
   */
  minimosTexto?: boolean;
};

// Chaînes littérales complètes : Tailwind v4 ne génère pas une classe fabriquée par interpolation.
const CLASE_BULLE =
  "rounded-full border-[1.5px] border-white bg-black/55 px-[3.14cqw] py-[0.87cqw] font-bold uppercase leading-tight text-white backdrop-blur-sm";

// Les tailles de texte, en `cqw` de la tuile, bornées. Seule la borne BASSE diffère : les planchers
// de S4, ou celle de l'accueil telle que Jérôme l'a validée (voir `minimosTexto`).
const TAILLES_TEXTE = {
  conMinimos: {
    nombre: "text-[clamp(0.8125rem,5.23cqw,1rem)]",
    subtitulo: "text-[clamp(0.75rem,4.18cqw,0.8125rem)]",
    bulle: "text-[clamp(0.6875rem,4.01cqw,0.8125rem)]",
  },
  portada: {
    nombre: "text-[clamp(0.6875rem,5.23cqw,1rem)]",
    subtitulo: "text-[clamp(0.625rem,4.18cqw,0.8125rem)]",
    bulle: "text-[clamp(0.625rem,4.01cqw,0.8125rem)]",
  },
} as const;

export function TeselaOferta({
  oferta,
  locale,
  labelDesde,
  labelCapacidad,
  labelConteo,
  sizes,
  prioridad = false,
  minimosTexto = true,
}: TeselaOfertaProps) {
  const tailles = TAILLES_TEXTE[minimosTexto ? "conMinimos" : "portada"];
  // La PREMIÈRE photo seulement (D6 = A) : une image par offre, pas un carrousel dans une vignette.
  const foto = oferta.fotos[0]?.url ?? null;

  // Les quatre formes du prix : `texto` tel quel, JAMAIS formaté en COP (un `price_label` libre,
  // « Entrada libre ») ; `null` → AUCUNE bulle, jamais « 0 COP ».
  const { precio } = oferta;
  const bullePrecio: ReactNode =
    precio?.tipo === "monto" ? (
      <Price amountCop={precio.cop} locale={locale} />
    ) : precio?.tipo === "desde" ? (
      // Le libellé et le montant dans UN élément : un lecteur d'écran lit « Desde 180.000 COP »
      // d'une traite.
      <>
        {labelDesde} <Price amountCop={precio.cop} locale={locale} />
      </>
    ) : precio?.tipo === "texto" ? (
      precio.label
    ) : null;

  // La capacité n'existe que sur les cartes de chambre d'une fiche établissement ; l'appelant ne
  // passe le libellé que si elle est connue.
  const bulleCapacidad = oferta.capacidad !== null && labelCapacidad ? labelCapacidad : null;

  // L'établissement en sous-titre ; une carte GROUPÉE n'en a pas (`establecimiento = null`) et
  // porte à la place son décompte de couchages. Mutuellement exclusifs par construction
  // (`search_catalog`).
  const sousTitre = oferta.establecimiento ?? (oferta.nAlojamientos !== null ? labelConteo : undefined);

  return (
    <div
      className="group @container relative grid aspect-square grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[16px] bg-[var(--default)]"
      data-testid={oferta.testId}
    >
      {foto ? (
        <NextImage
          src={foto}
          alt=""
          fill
          sizes={sizes}
          priority={prioridad}
          // ⚠️ `undefined` sous `priority`, jamais `"eager"` : next/image lève si les deux sont posés
          // (même forme que l'atome `Image`).
          loading={prioridad ? undefined : "lazy"}
          className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none"
        />
      ) : null}
      <div className="z-[1] col-start-1 row-start-1 flex min-w-0 flex-col items-end justify-end gap-[2.79cqw] p-[4.18cqw]">
        {bullePrecio !== null || bulleCapacidad !== null ? (
          // Une bulle par information présente, à droite, retour à la ligne si la tuile est étroite.
          <div className="flex flex-wrap justify-end gap-[2.09cqw]">
            {bullePrecio !== null ? (
              <span className={`${CLASE_BULLE} ${tailles.bulle}`} data-testid={`${oferta.testId}-precio`}>
                {bullePrecio}
              </span>
            ) : null}
            {bulleCapacidad !== null ? (
              <span className={`${CLASE_BULLE} ${tailles.bulle}`} data-testid={`${oferta.testId}-capacidad`}>
                {bulleCapacidad}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="w-full rounded-[4.88cqw] bg-[var(--background)] px-[4.18cqw] py-[3.14cqw] text-center leading-tight text-[var(--foreground)]">
          <Link
            href={oferta.href}
            className={`line-clamp-2 ${tailles.nombre} font-bold uppercase focus-visible:outline-none after:absolute after:inset-0 after:z-[1] after:content-[''] focus-visible:after:ring-4 focus-visible:after:ring-inset focus-visible:after:ring-[var(--accent)]`}
            data-testid={`${oferta.testId}-link`}
          >
            {oferta.nombre}
          </Link>
          {sousTitre ? (
            <p className={`mt-[0.7cqw] line-clamp-1 ${tailles.subtitulo} font-medium`}>
              {sousTitre}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
