import type { AmenidadPorCategoria } from "@/lib/catalog/tipos";
import { Title } from "@/components/atoms/Title";

// Présentation pure — reçoit des chaînes déjà résolues dans la locale, ne traduit rien elle-même
// (`.claude/rules/apps.md`). Liste à puces classique par catégorie, PAS des chips/labels : chaque
// catégorie son `<h3>` suivi de sa `<ul>`, verticale — décision explicite de Jérôme (2026-09-17),
// pas un `flex-wrap` de pastilles.
//
// Les GROUPES se rangent en colonnes selon la largeur de LEUR conteneur (plan 41, P3 et P4) : une
// sous 448 px (mobile), deux au-delà (colonne de lecture de la fiche produit, 560 px), trois à
// partir de 768 px (fiche établissement, 960 px). Requête de conteneur et non de vue : la même liste
// vit dans deux colonnes de largeurs différentes à la même largeur d'écran. Chaque liste reste
// verticale, comme décidé le 2026-09-17.
export function AmenidadesList({
  grupos,
  testId,
}: {
  grupos: AmenidadPorCategoria[];
  testId: string;
}) {
  return (
    <div className="@container" data-testid={testId}>
      <div className="grid gap-x-8 gap-y-4 @md:grid-cols-2 @3xl:grid-cols-3">
        {grupos.map((grupo) => (
          <div key={grupo.categoria} className="flex flex-col gap-1">
            {/* `etiqueta` : Poppins 600, jamais la police de titre à 14 px (plan 41, F2). */}
            <Title as="h3" size="etiqueta">
              {grupo.categoria}
            </Title>
            <ul className="list-disc pl-5 text-sm text-muted">
              {grupo.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
