"use client";

import { useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { Title } from "@/components/atoms/Title";
// Calendar/CalendarDayButton restent volontairement sur react-day-picker (pas le Calendar HeroUI
// v3, encore "in progress" et d'API CalendarDate totalement différente) : logique de
// modifiers/disabled/DayButton custom (dates pleines/dernière place, attribut data-date ciblé par
// plusieurs specs Playwright) qu'un remplacement ne pourrait pas reproduire à l'identique sans
// risquer une régression — décision à trancher séparément (cf. hifago/CLAUDE.md, point ouvert).
import {
  Button,
  DayPickerCalendar as Calendar,
  Input,
  Label,
  TextField,
  cn,
  dateTaggedDayButtonComponents,
} from "@hifago/ui";
import { startOfTodayInBogota } from "@hifago/domain";
import { Price } from "@/components/atoms/Price";
import { hrefAlojamientosCompatibles } from "@/lib/catalog/criterios";
import { ultimoDiaCampIso } from "@/lib/cart/campMissingLodging";
import { useCart } from "@/lib/cart/CartContext";
import { useAddToCart } from "@/lib/cart/useAddToCart";
import {
  formatEditionDateRange,
  isoDeFecha,
  mesPorDefecto,
  ultimoDiaReservable,
} from "@/lib/reservas/calendario";
import { limitarCantidad, pisoCantidad, topeCantidad } from "@/lib/reservas/cantidad";
import {
  CLAVE_PLAZAS,
  agregarEnCarrito,
  estadoDisponibilidad,
  plazasRestantes,
} from "@/lib/reservas/disponibilidad";
import { usePrefillUltimosCriterios } from "@/lib/reservas/usePrefillUltimosCriterios";
import type { PrecioTarjeta } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";

type AvailabilityRow = { date: string; capacity: number; booked: number };

// Retour Gabriel (2026-09-16) : nombre de cartes visibles avant le bouton « voir plus ».
const EDICIONES_VISIBLES_INICIALMENTE = 5;

export function ReservationForm({
  productId,
  availability,
  durationDays = 1,
  minQty = 1,
  groupDiscount,
  precio = null,
  unidad = null,
  locale = "es",
  onSalidaChange,
}: {
  productId: string;
  availability: AvailabilityRow[];
  /**
   * `products.duration_days` — non nul seulement pour `camp`. `availability` ne porte que la date
   * de DÉPART de chaque édition (`product_availability`, une ligne par départ, jamais une par
   * jour) : ce champ dit sur combien de jours faire apparaître/surligner la semaine complète autour
   * d'un départ, purement visuel. La donnée envoyée au panier reste toujours la date de départ
   * seule (`selectedIso`) — jamais une plage — `create_order` calcule les jours bloqués côté
   * serveur depuis `products.duration_days`, un `end_date` ferait basculer la ligne dans la branche
   * de tarification NUITÉE de lodging (cf. son propre branchement sur la seule présence d'`end_date`).
   */
  durationDays?: number;
  /**
   * Notifie la fiche de la salida sélectionnée, pour qu'elle date le programme du camp (spec 37).
   * ⚠️ Simple MIROIR en écriture : ce composant reste seul propriétaire de `selectedDate`, il ne
   * reçoit rien en retour. Faire l'inverse (remonter l'état, rendre ce formulaire contrôlé)
   * toucherait selectedDate/selectedRow/remaining/diasSemanaSeleccionada, le reset de `qty` et le
   * prefill dans un fichier déjà couvert par un test à horloge figée — coût sans bénéfice de rendu.
   */
  onSalidaChange?: (salidaIso: string | null) => void;
  /** `products.min_qty`, replié à 1 — cf. `lib/reservas/cantidad.ts`. */
  minQty?: number;
  /**
   * `products.group_discount_threshold_qty`/`group_discount_pct` (migration 20260914130000) —
   * non défini pour tout type autre que camp. Texte informatif statique seulement (décision
   * Jérôme) : jamais un compteur de remplissage en temps réel ni un prix recalculé ici — le prix
   * engageant reste révélé uniquement par `create_order` au checkout.
   */
  groupDiscount?: { umbralPersonas: number; porcentaje: number };
  /** `ficha.precio` — repliée à `null` : les formulaires de test/produits sans prix connu existent. */
  precio?: PrecioTarjeta;
  /** `ficha.unidad` (`per_person`/`per_two`/`per_house`) — suffixe la ligne de prix d'une carte. */
  unidad?: string | null;
  /** Nécessaire pour `<Price>` et pour le nom des mois de `formatEditionDateRange`. */
  locale?: Locale;
}) {
  const t = useTranslations("ProductPage");
  const { lines } = useCart();
  const addToCart = useAddToCart();
  // Borne HAUTE de l'horizon produit (six mois, décidé le 2026-08-28). Le `useMemo` reste ici et
  // n'est pas décoratif : react-day-picker doit recevoir la MÊME référence d'un rendu à l'autre.
  const dernierJourReservable = useMemo(() => ultimoDiaReservable(), []);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [qty, setQty] = useState(minQty);
  // Retour Gabriel (2026-09-16) : au-delà de EDICIONES_VISIBLES_INICIALMENTE, la liste s'allongeait
  // sans borne (un camp à 10 départs affichait 10 cartes) — plafonnée, avec un bouton qui en
  // dévoile EDICIONES_VISIBLES_INICIALMENTE de plus à chaque clic (jamais tout d'un coup). Jamais
  // réduit une fois déployé : aucun bouton « voir moins » demandé.
  const [edicionesVisiblesCount, setEdicionesVisiblesCount] = useState(
    EDICIONES_VISIBLES_INICIALMENTE
  );

  const byDate = useMemo(
    () => new Map(availability.map((row) => [row.date, row])),
    [availability]
  );

  // Jour ISO -> ISO du départ dont il fait partie (lui-même si `durationDays` vaut 1, le défaut).
  // Sert à la fois à autoriser le CLIC n'importe où dans la semaine et à retrouver le départ réel
  // à partir du jour cliqué — `byDate` (donc `selectedRow`/`remaining`) ne connaît lui QUE les
  // départs, jamais les jours intermédiaires.
  const porJourDepart = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of availability) {
      const depart = parseISO(row.date);
      for (let i = 0; i < durationDays; i += 1) {
        map.set(format(addDays(depart, i), "yyyy-MM-dd"), row.date);
      }
    }
    return map;
  }, [availability, durationDays]);

  // Cupos déjà occupés par CE produit/CETTE date dans le panier en cours (pas encore en base) —
  // le plafond client reste indicatif (jamais la vraie barrière, qui reste exclusivement
  // create_order au moment du checkout), mais ignorer ce qui est déjà dans le panier laisserait
  // ajouter deux fois la même dernière place sans le moindre avertissement visuel.
  const inCartByDate = useMemo(
    () => agregarEnCarrito(lines, (line) => line.productId === productId, (line) => line.date),
    [lines, productId]
  );

  const fullDates = useMemo(() => {
    const full: Date[] = [];
    for (const row of availability) {
      // Le MÊME seuil que le message affiché dessous — écrit une fois, dans `disponibilidad.ts`.
      // Avant, le calendrier et la phrase portaient chacun leur propre `<= 0`.
      const estado = estadoDisponibilidad(plazasRestantes(row, inCartByDate.get(row.date) ?? 0));
      if (estado === "completo") full.push(parseISO(row.date));
    }
    return full;
  }, [availability, inCartByDate]);

  // Liste d'éditions sous l'agenda (retour Jérôme, 2026-09-15) : seulement pour un camp
  // multi-jours, jamais pour une activité/un transport à date simple passant par ce même
  // formulaire — `durationDays > 1` est déjà, plus haut, le signal qui distingue les deux
  // (`diasSemanaSeleccionada`/surlignage `campWeek` ne s'activent que dans ce cas).
  const afficherEditions = durationDays > 1 && availability.length > 0;
  const edicionesVisibles = availability.slice(0, edicionesVisiblesCount);
  const edicionesOcultasCount = availability.length - edicionesVisibles.length;

  // Ne dépend d'AUCUNE ligne : calculé une fois, pas une fois par édition affichée (il l'était, avec
  // son lookup ICU, à chaque tour de la boucle, pour un résultat identique).
  const unidadSuffix =
    unidad === "per_person"
      ? t("perPerson")
      : unidad === "per_house"
        ? t("perHouse")
        : unidad === "per_two"
          ? t("editionPriceForTwo", { count: 2 })
          : null;

  const selectedIso = isoDeFecha(selectedDate);
  const selectedRow = selectedIso ? byDate.get(selectedIso) : undefined;
  const remaining = selectedRow
    ? plazasRestantes(selectedRow, inCartByDate.get(selectedRow.date) ?? 0)
    : 0;

  // Ouvre le calendrier sur le mois de la première date configurée plutôt que sur le mois
  // courant — sans ça, un visiteur (ou un test e2e) devrait naviguer manuellement jusqu'à la
  // première disponibilité réelle.
  // Repli sur le mois de GUATAPÉ, jamais `undefined` : sans disponibilité en base, react-day-picker
  // retombe sur son propre `new Date()`, c'est-à-dire sur le mois du NAVIGATEUR. Le visiteur
  // européen du 1er du mois à 2 h voyait alors le mois suivant s'ouvrir, avec le dernier jour du
  // mois précédent — pourtant réservable — présenté comme déjà passé. (Angle mort trouvé par la
  // relecture adversariale du lot fuseau, pas par la liste initiale.)
  const defaultMonth = mesPorDefecto(availability[0]?.date);

  // Les jours à surligner autour du départ SÉLECTIONNÉ — vide dès que `durationDays` vaut 1 (tous
  // les autres types passant par ce formulaire), donc sans effet visuel hors camp.
  const diasSemanaSeleccionada = useMemo(() => {
    if (!selectedIso || durationDays <= 1) return [];
    const depart = parseISO(selectedIso);
    return Array.from({ length: durationDays }, (_, i) => addDays(depart, i));
  }, [selectedIso, durationDays]);

  // UN SEUL prédicat « cette date est-elle refusée ? », passé tel quel au `disabled` du calendrier
  // ET appelé en tête de `handleSelectDate` — le pré-remplissage (spec 28 §4 point 3) appelle ce
  // handler HORS du calendrier. Écrire les conditions deux fois, à cinquante lignes d'écart, les
  // laissait diverger en silence : chaque formulaire n'en avait recopié qu'une partie, et l'écart
  // n'était visible que par le chemin le moins testé.
  //
  // Bornes : minuit à GUATAPÉ, jamais l'heure du NAVIGATEUR (lot fuseau, 2026-08-28) — un visiteur
  // européen ouvrant la fiche le 1er du mois à 2 h du matin voyait le dernier jour du mois
  // précédent barré, alors qu'à Guatapé il était encore réservable. Borne HAUTE : au-delà de
  // l'horizon produit rien n'est vendable, sans elle ces dates paraissaient sélectionnables et
  // n'étaient refusées qu'après coup.
  function fechaNoSeleccionable(date: Date): boolean {
    return (
      date < startOfTodayInBogota() ||
      date > dernierJourReservable ||
      !porJourDepart.has(format(date, "yyyy-MM-dd"))
    );
  }

  function handleSelectDate(date: Date | undefined) {
    if (!date) {
      setSelectedDate(undefined);
      setQty(minQty);
      onSalidaChange?.(null);
      return;
    }
    // `product_availability` n'a AUCUNE borne côté requête (lib/catalog/producto.ts) : une ligne
    // passée ou hors de l'horizon de 6 mois peut légitimement s'y trouver. Un clic réel ne peut
    // jamais atteindre cette branche (déjà exclu par le même prédicat), donc aucun changement de
    // comportement au clic.
    if (fechaNoSeleccionable(date)) return;
    // Cliquer n'importe quel jour de la semaine sélectionne le DÉPART de cette semaine, jamais le
    // jour cliqué lui-même — `byDate` (et donc la capacité/le panier) ne connaît que les départs.
    // La clé est garantie présente par le prédicat ci-dessus.
    const departIso = porJourDepart.get(format(date, "yyyy-MM-dd"))!;
    setSelectedDate(parseISO(departIso));
    setQty(minQty);
    // Notifie la fiche pour qu'elle DATE le programme du camp (spec 37). Posé ici, dans l'unique
    // point d'écriture de la sélection, donc valable aussi pour le clic sur une carte d'édition et
    // pour le pré-remplissage depuis l'URL, qui passent tous deux par cette fonction.
    onSalidaChange?.(departIso);
  }

  // Spec 28 §4 point 3 : la date filtrée dans la recherche, si elle correspond à un départ réel de
  // CE produit, est déjà posée en arrivant sur la fiche — même garde que le clic (ci-dessus).
  usePrefillUltimosCriterios(({ desde }) => {
    if (desde) handleSelectDate(parseISO(desde));
  });

  // Spec 28 Tranche 3 : sur succès, `useAddToCart` redirige vers l'accueil — SAUF pour un camp de
  // plus d'un jour (2026-09-15), qui redirige vers `/alojamientos` avec les dates et le nombre de
  // personnes du départ choisi déjà en filtre : on ne peut plus prendre un camp sans réserver un
  // hébergement pour ses nuits. `durationDays > 1` est le même signal qu'`afficherEditions` plus
  // haut (seul un camp multi-jours le porte) ; un camp d'une seule journée (duration_days = 1)
  // n'exige aucune nuitée et ne redirige pas. L'obligation RÉELLE reste `create_order` (raison
  // `camp_missing_lodging`) — ceci n'est qu'un guidage, jamais la garantie.
  // `hasta` reste LOCAL à ce handler, jamais injecté dans l'objet passé à `addToCart` : la donnée
  // envoyée au panier reste la date de départ seule (cf. commentaire de `durationDays` ci-dessus).
  // La formule vient de `campMissingLodging.ts`, le module qui est déjà le miroir désigné de
  // `create_order` pour cette règle — jamais recopiée ici, sans quoi elle vivrait à trois endroits.
  async function handleAddToCart() {
    if (!selectedIso || remaining < 1) return;
    const hrefRetorno =
      durationDays > 1
        ? hrefAlojamientosCompatibles({
            desde: selectedIso,
            hasta: ultimoDiaCampIso(selectedIso, durationDays),
            personas: qty,
          })
        : undefined;
    await addToCart({ productId, date: selectedIso, qty }, hrefRetorno ? { hrefRetorno } : undefined);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Title as="h2" size="bloque">
          {t("availabilityTitle")}
        </Title>
        <Calendar
          mode="single"
          defaultMonth={defaultMonth}
          selected={selectedDate}
          // Le jour « aujourd'hui » mis en avant par react-day-picker vient sinon de son propre
          // `dateLib.today()` = `new Date()` du runtime (DayPicker.js:167), donc du NAVIGATEUR.
          // Sans cette prop, le correctif de `disabled` ci-dessous et le surlignage se
          // contrediraient pour un visiteur hors Colombie : le 27 resterait cliquable mais le 28
          // serait peint comme « aujourd'hui ».
          today={startOfTodayInBogota()}
          onSelect={handleSelectDate}
          disabled={[fechaNoSeleccionable]}
          modifiers={{ full: fullDates, campWeek: diasSemanaSeleccionada }}
          modifiersClassNames={{
            full: "line-through opacity-60",
            campWeek: "bg-accent/20",
          }}
          // data-date (ISO, indépendant de la locale) : cible stable pour les tests e2e, la locale
          // d'affichage du calendrier ne doit jamais faire flancher un sélecteur de test. Référence
          // module-scope (packages/ui), jamais reconstruite ici à chaque rendu — cf. sa doc.
          components={dateTaggedDayButtonComponents}
        />
      </div>

      {afficherEditions ? (
        <div>
          <Title as="h2" size="bloque">
            {t("chooseEditionTitle")}
          </Title>
          <p className="mb-2 text-xs text-muted">{t("chooseEditionSubtitle")}</p>
          <div className="flex flex-col gap-2" data-testid="edition-cards">
            {edicionesVisibles.map((row) => {
              const isSelected = row.date === selectedIso;
              const remainingRow = plazasRestantes(row, inCartByDate.get(row.date) ?? 0);
              const isFull = estadoDisponibilidad(remainingRow) === "completo";
              const dateLabel = formatEditionDateRange(row.date, durationDays, locale);

              return (
                <button
                  key={row.date}
                  type="button"
                  data-testid={`edition-card-${row.date}`}
                  aria-pressed={isSelected}
                  disabled={isFull}
                  // Même chemin de code qu'un clic calendrier — un seul état (`selectedDate`),
                  // jamais deux à réconcilier : `porJourDepart.get(row.date)` vaut toujours
                  // `row.date` lui-même (la boucle qui le construit pose `i=0 → map.set(row.date,
                  // row.date)`), donc `handleSelectDate` retrouve exactement ce départ.
                  onClick={() => handleSelectDate(parseISO(row.date))}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
                    isFull
                      ? "cursor-not-allowed border-border opacity-50 line-through"
                      : isSelected
                        ? "border-accent bg-surface-secondary"
                        : "border-border hover:bg-surface-secondary"
                  )}
                >
                  <span className="text-xs font-medium text-muted">
                    {isFull ? t("full") : t("editionSpotsBadge", { count: remainingRow })}
                  </span>
                  <span className="text-sm font-semibold">{dateLabel}</span>
                  <span className="text-xs text-muted">
                    {t("editionNights", { count: durationDays })}
                    {precio ? (
                      <>
                        {" · "}
                        {precio.tipo === "texto" ? (
                          precio.label
                        ) : (
                          <Price amountCop={precio.cop} locale={locale} />
                        )}
                      </>
                    ) : null}
                    {unidadSuffix ? <> {unidadSuffix}</> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {edicionesOcultasCount > 0 ? (
            <Button
              variant="outline"
              className="mt-2 rounded-[4px]"
              data-testid="show-more-editions"
              onPress={() => setEdicionesVisiblesCount((count) => count + EDICIONES_VISIBLES_INICIALMENTE)}
            >
              {t("showMoreEditions", {
                count: Math.min(EDICIONES_VISIBLES_INICIALMENTE, edicionesOcultasCount),
              })}
            </Button>
          ) : null}
        </div>
      ) : null}

      {groupDiscount ? (
        <p className="text-sm text-muted" data-testid="group-discount-hint">
          {t("groupDiscount", {
            threshold: groupDiscount.umbralPersonas,
            pct: groupDiscount.porcentaje,
          })}
        </p>
      ) : null}

      {selectedRow ? (
        <p className="text-sm text-muted" aria-live="polite">
          {t(CLAVE_PLAZAS[estadoDisponibilidad(remaining)], { count: remaining })}
        </p>
      ) : (
        <p className="text-sm text-muted">{t("selectDate")}</p>
      )}

      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        isDisabled={!selectedRow}
        onChange={(value) => setQty(limitarCantidad(Number(value), minQty, remaining))}
      >
        <Label>{t("quantityLabel")}</Label>
        <Input id="qty" type="number" min={pisoCantidad(minQty, remaining)} max={topeCantidad(remaining)} />
      </TextField>
      {minQty > 1 ? (
        <p className="text-xs text-muted" data-testid="min-qty-hint">
          {t("minQtyHint", { count: minQty })}
        </p>
      ) : null}

      <Button
        data-testid="add-to-cart-button"
        onPress={handleAddToCart}
        isDisabled={!selectedRow || remaining < 1}
      >
        {t("addToCart")}
      </Button>
    </div>
  );
}
