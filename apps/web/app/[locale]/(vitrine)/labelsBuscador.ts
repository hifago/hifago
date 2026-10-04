import { getTranslations } from "next-intl/server";
import type { SearchPanelLabels } from "@/components/organisms/SearchPanel";
import type { Locale } from "@/messages";

// Les libellés du panneau de recherche, traduits UNE fois pour les trois écrans qui le montent :
// l'accueil (`page.tsx`), les cinq listings (`ListadoTipo.tsx`) et l'index de catégories
// (`actividades/page.tsx`). Spec 28 §0 pour le composant, spec 29 décision 10 pour sa présence sur
// les listings.
//
// ⚠️ POURQUOI UNE FONCTION ET PAS TROIS LITTÉRAUX. Les trois blocs étaient identiques au nom du
// traducteur près (`t` sur l'accueil, `tHome` ailleurs) — vingt-quatre lignes, trois fois, toutes
// dans le namespace `HomePage`. Et le typecheck ne protège PAS de leur divergence : `valueLabel`
// est OPTIONNEL dans `SearchPanelLabels`, donc un libellé facultatif ajouté demain sur un seul des
// trois écrans compile, passe le lint et ne casse aucun test — le panneau serait simplement moins
// complet sur deux pages que sur la troisième.
//
// ⚠️ Toutes les clés viennent de `HomePage`, y compris sur un listing, et ce n'est pas un reste :
// c'est le MÊME panneau, donc les mêmes libellés. Un second jeu de clés divergerait à la première
// retouche — la même raison qui fait lire à `libelles()` la clé de section de l'accueil.
//
// ⚠️ Ce module reste SERVEUR (`getTranslations`, pas `useTranslations`) et n'importe de
// `SearchPanel` qu'un TYPE : un `import type` est effacé à la compilation, donc le barrel
// `@hifago/ui` n'entre pas dans le graphe des `page.tsx` qui l'appellent (CLAUDE.md §11.16).
export async function labelsBuscador(locale: Locale): Promise<SearchPanelLabels> {
  const t = await getTranslations({ locale, namespace: "HomePage" });

  return {
    search: {
      label: t("buscar.label"),
      placeholder: t("buscar.placeholder"),
      submitLabel: t("buscar.submitLabel"),
      emptyLabel: t("buscar.emptyLabel"),
      clearLabel: t("buscar.clearLabel"),
    },
    dates: {
      placeholderLabel: t("fechas.placeholderLabel"),
      calendar: {
        complet: t("fechas.calendar.complet"),
        selectionne: t("fechas.calendar.selectionne"),
        aujourdhui: t("fechas.calendar.aujourdhui"),
      },
    },
    people: {
      placeholderLabel: t("personas.placeholderLabel"),
      fieldLabel: t("personas.fieldLabel"),
      stepLabels: {
        increment: t("personas.stepLabels.increment"),
        decrement: t("personas.stepLabels.decrement"),
      },
    },
  };
}
