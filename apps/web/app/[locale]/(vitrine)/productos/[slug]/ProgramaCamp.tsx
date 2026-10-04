import { Title } from "@/components/atoms/Title";
import { fechaDelDiaDePrograma } from "@/lib/reservas/calendario";
import type { Locale } from "@/messages";

// Le déroulé jour par jour d'un camp (spec 37) — l'héritier structuré du champ `program` de la V1,
// qui l'affichait déjà en liste à puces sous « El plan, día a día » (public/reservar.js:199).
//
// Colocalisé dans la route : il ne sert qu'à la fiche produit, donc il ne remonte pas dans
// components/ (apps/web/components/README.md — on ne mutualise que ce qui sert à deux endroits).
//
// Il ne porte AUCUNE logique de données : les lignes arrivent déjà résolues dans la locale et
// regroupées par journée (lib/catalog/programa.ts), et les libellés arrivent déjà traduits en
// props — un atome/bloc de présentation ne traduit rien et ne résout aucun JSONB.
//
// ⚠️ Rendu TOUJOURS en entier : jamais un accordéon fermé par défaut, jamais un `hidden md:block`.
// C'est du contenu indexable, et `.claude/rules/seo.md` interdit de le cacher derrière une
// interaction ou selon la largeur.
export function ProgramaCamp({
  programa,
  salidaIso,
  locale,
  titulo,
  etiquetaDia,
  etiquetaDiaConFecha,
  testId = "programa-camp",
}: {
  programa: { dia: number; lineas: string[] }[];
  /**
   * Salida sélectionnée (ou la première encore ouverte). `null` → on n'affiche que « Día N ». La
   * date n'est donc jamais inventée : soit elle est vraie, soit elle est absente.
   */
  salidaIso: string | null;
  locale: Locale;
  titulo: string;
  /** Libellé sans date, déjà traduit et interpolé par l'appelant (ex. « Día 2 »). */
  etiquetaDia: (dia: number) => string;
  /** Libellé avec la date réelle (ex. « Día 2 · lun 16 nov »). */
  etiquetaDiaConFecha: (dia: number, fecha: string) => string;
  testId?: string;
}) {
  if (programa.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" data-testid={testId}>
      {/* h2 via l'atome, jamais Card.Title : celui de HeroUI rend un h3 et rouvrirait le saut de
          hiérarchie que la fiche vient de corriger (spec 30). */}
      <Title as="h2" size="bloque">
        {titulo}
      </Title>

      <ol className="flex flex-col gap-3">
        {programa.map(({ dia, lineas }) => (
          <li key={dia} className="flex flex-col gap-1">
            <p className="text-sm font-medium" data-testid={`${testId}-dia-${dia}`}>
              {salidaIso
                ? etiquetaDiaConFecha(dia, fechaDelDiaDePrograma(salidaIso, dia, locale))
                : etiquetaDia(dia)}
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {lineas.map((linea, index) => (
                <li key={index} className="text-sm text-muted">
                  {linea}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
