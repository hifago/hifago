// Les locales de `DayPickerCalendar` (2026-10-03, plan 41 de la vitrine, item S10). AJOUT PUR :
// aucun composant existant ne change.
//
// Celles de react-day-picker et non celles de date-fns : elles ÉTENDENT la locale date-fns (mois,
// jours, premier jour de semaine) avec les libellés d'accessibilité de la grille — « Ir al mes
// anterior », « Hoy, … , seleccionado ». Avec une locale date-fns seule, ces libellés restent en
// anglais en dur (`defaultLabels` de react-day-picker), et un visiteur hispanophone au lecteur
// d'écran entend « Go to the Previous Month ».
//
// Réexportées ICI parce que react-day-picker est une dépendance de `packages/ui`, pas des apps :
// une app qui l'importerait directement dépendrait d'un paquet qu'elle ne déclare pas.
export { es as localeCalendarioEs, enUS as localeCalendarioEn } from "react-day-picker/locale";
