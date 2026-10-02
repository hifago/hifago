import { getTranslations } from "next-intl/server";
import { ORDEN_SECCIONES, type TipoOferta } from "@/lib/catalog/tipos";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import type { Locale } from "@/messages";

// Les cinq types de la navigation du héros de l'accueil (`MenuTiposPortada`, qui a remplacé
// `SelectorTipo` le 2026-10-01 avec la maquette de Jérôme — le sélecteur a été supprimé, il ne
// servait que l'accueil). Jusqu'au 2026-09-15, cette fonction servait les cinq écrans qui montraient
// encore un sélecteur de type (l'accueil, les quatre listings, l'index de catégories, les deux
// fiches) ; depuis le retour de Jérôme qui l'a réservé à la home (`Migas` seul partout ailleurs),
// `page.tsx` (l'accueil) en est le SEUL appelant. Laissée en fonction séparée plutôt que réinlinée :
// elle compose deux sources de vérité déjà tranchées ailleurs (voir plus bas) et resterait la bonne
// extension le jour où un second écran remonterait cette navigation.
//
// ⚠️ La route est dérivée de deux sources de vérité déjà tranchées ailleurs : `ORDEN_SECCIONES`
// (ordre d'affichage, `lib/catalog/tipos.ts`) et `segmentoDeTipo` (type → segment d'URL,
// `lib/catalog/segmentos.ts`). Cette fonction ne fait que les composer avec la traduction.
//
// ⚠️ LE LIBELLÉ VIENT DE `HomePage.tiposPortada.*` DEPUIS LE 2026-10-01, plus de `secciones.*` : la
// maquette de l'accueil fournie par Jérôme écrit « Alojamiento », « Transporte » et « Retiros » (les
// camps), là où les pages de listing et le fil d'Ariane gardent « Alojamientos », « Transportes »,
// « Camps ». Une clé à part plutôt qu'un renommage de `secciones.*` : renommer aurait changé les
// titres et le fil d'Ariane de pages que la maquette ne couvre pas. Les sections de l'accueil
// (`page.tsx`) lisent la même clé, pour que le menu et les titres disent la même chose.
//
// ⚠️ Ce module reste SERVEUR (`getTranslations`, pas `useTranslations`) et n'importe de `tipos.ts`
// que des types/constantes sans dépendance — comme `labelsBuscador.ts`, ça évite de faire entrer le
// barrel `@hifago/ui` dans le graphe d'un Server Component par transitivité (CLAUDE.md §11.16).
// ⚠️ `sufijoCriterios` (2026-09-16, bug Jérôme : « en changeant de page les filtres s'enlèvent »)
// est calculé par l'appelant, jamais recalculé ici — même contrat que `hrefSeccion`/
// `hrefCategoria` (`lib/catalog/buscar.ts`), qui composent déjà ce même suffixe.
export async function tiposDeBarra(
  locale: Locale,
  sufijoCriterios: string
): Promise<{ tipo: TipoOferta; label: string; href: string }[]> {
  const t = await getTranslations({ locale, namespace: "HomePage" });

  return ORDEN_SECCIONES.map((tipo) => ({
    tipo,
    label: t(`tiposPortada.${tipo}`),
    href: `/${segmentoDeTipo(tipo)}${sufijoCriterios}`,
  }));
}
