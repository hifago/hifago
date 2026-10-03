"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { DatesSetArg, EventContentArg, EventInput } from "@fullcalendar/core";
import Link from "next/link";
import "./availability-calendar.css";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, Modal, Switch, buttonVariants, toast } from "@hifago/ui";
import { addDays } from "@/lib/products/dates";
import { useDateRateEditor } from "./use-date-rate-editor";

type AvailabilityRow = { date: string; capacity: number; booked: number };
type CalendarRow = { date: string; open: boolean };
// Spec 17 §0 Tranche 2 — product_date_rates (set_date_rate('product', ...)) : une seule ligne par
// date exacte, jamais fournie en mode "resource" (pas de notion de prix pour une ressource
// partagée).
type RateRow = { date: string; price_cop: number };
type SetAvailabilityResult = { ok: boolean; reason?: string; booked?: number };

// Même service pour l'admin (feature 5) et le socio (feature 17) — cf. cahier des charges socio
// §3d : "jamais deux vérités différentes du même calendrier". set_product_availability retourne
// désormais jsonb {ok, reason} (feature 17 a remplacé l'exception par un refus métier normal pour
// tout appelant non-admin) — messages mappés proprement, jamais un code brut affiché.
const AVAILABILITY_ERRORS: Record<string, string> = {
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  product_not_found: "No se encontró la actividad.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
  // Capacité négative (20261001144546), même message que slot-availability-grid.tsx.
  invalid_capacity: "La capacidad debe ser un número válido.",
};

function messageFor(result: SetAvailabilityResult | null): string {
  if (result?.reason === "below_booked") {
    return `La capacidad no puede ser menor a las ${result.booked} plazas ya reservadas.`;
  }
  return (
    AVAILABILITY_ERRORS[result?.reason ?? ""] ??
    "No se pudo guardar la disponibilidad. Inténtalo de nuevo."
  );
}

// Un jour à la fois : closed (fermé, explicite ou via calendar_default_open) prime toujours sur
// configured (une ligne product_availability existe) qui prime sur default (produits.
// default_capacity non nul, aucune ligne explicite) qui prime sur unconfigured (aucune ligne, pas
// de default_capacity) — cf. plan feature 5, complété le 2026-08-18 par products.default_capacity.
// Un override explicite ("configured", même booked=0) n'est donc jamais masqué par le badge par
// défaut : seule l'absence totale de ligne bascule sur "default".
function statusFor(
  dateStr: string,
  availabilityByDate: Map<string, AvailabilityRow>,
  calendarByDate: Map<string, boolean>,
  calendarDefaultOpen: boolean,
  defaultCapacity: number | null,
) {
  const explicitOpen = calendarByDate.get(dateStr);
  const isOpen = explicitOpen ?? calendarDefaultOpen;
  if (!isOpen) {
    return { kind: "closed" as const };
  }
  const row = availabilityByDate.get(dateStr);
  if (row) {
    return { kind: "configured" as const, capacity: row.capacity, booked: row.booked };
  }
  if (defaultCapacity !== null) {
    return { kind: "default" as const, capacity: defaultCapacity };
  }
  return { kind: "unconfigured" as const };
}

// Champ Capacidad — identique dans les deux branches de rendu ci-dessous (mode "resource" et mode
// "product" : formulaire cupo+abierto), extrait pour ne pas dupliquer le Label+Input+onChange.
// Seul le champ est extrait, pas les deux <form> qui le portent (leur soumission/état de chargement
// restent distincts, cf. commentaires plus bas).
function CapacityField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="capacity">Capacidad</Label>
      <Input
        id="capacity"
        name="capacity"
        type="number"
        min={0}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// Champs du formulaire dans un composant séparé, avec son propre état local (capacité, ouvert,
// erreur, soumission) — sans cette extraction, chaque frappe dans le champ capacité re-rendait
// AvailabilityCalendar en entier, donc <FullCalendar> (qui n'a pas de shouldComponentUpdate :
// `componentDidUpdate` réinitialise systématiquement ses options), remontant toute la grille du
// mois à chaque caractère tapé.
function AvailabilityFormFields({
  selectedDate,
  entityId,
  mode,
  initialCapacity,
  initialOpen,
  initialBooked,
  initialPrice,
  onSaved,
}: {
  selectedDate: string;
  entityId: string;
  mode: "product" | "resource";
  initialCapacity: string;
  initialOpen: boolean;
  initialBooked: number;
  // Toujours fourni par le parent (vide si aucun override ou en mode "resource", cf.
  // AvailabilityCalendar) — set_date_rate n'existe que pour p_entity_type='product', jamais lu ni
  // affiché en mode "resource".
  initialPrice: string;
  onSaved: () => void;
}) {
  const [capacityInput, setCapacityInput] = useState(initialCapacity);
  const [openInput, setOpenInput] = useState(initialOpen);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Precio especial (product_date_rates via set_date_rate) — état et soumission gérés par
  // useDateRateEditor ; indépendant de handleSubmit ci-dessous (aucun des deux ne bloque ni
  // n'attend l'autre). set_date_rate n'existe que pour p_entity_type='product', jamais appelé en
  // mode "resource" (composant retourné plus bas avant même d'utiliser priceInput/
  // handlePriceSubmit).
  const { priceInput, setPriceInput, isSavingPrice, handlePriceSubmit } = useDateRateEditor({
    entityType: "product",
    entityId,
    date: selectedDate,
    initialPrice,
    notFoundLabel: "No se encontró la actividad.",
    genericErrorLabel: "No se pudo guardar el precio especial. Inténtalo de nuevo.",
    onSaved,
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const capacity = Number(capacityInput);
    if (!Number.isFinite(capacity) || capacity < 0) {
      toast.danger("La capacidad debe ser un número válido.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    // set_provider_resource_capacity n'a pas de p_open (pas de notion de fermeture calendaire pour
    // une ressource partagée) — seul set_product_availability en a besoin.
    const { data, error: rpcError } =
      mode === "resource"
        ? await supabase.rpc("set_provider_resource_capacity", {
            p_establishment_id: entityId,
            p_date: selectedDate,
            p_capacity: capacity,
          })
        : await supabase.rpc("set_product_availability", {
            p_product_id: entityId,
            p_date: selectedDate,
            p_capacity: capacity,
            p_open: openInput,
          });

    setIsSubmitting(false);

    const result = data as SetAvailabilityResult | null;
    if (rpcError || !result?.ok) {
      toast.danger(messageFor(result));
      return;
    }

    toast.success("Disponibilidad actualizada.");
    onSaved();
  }

  // Mode "resource" (capacité d'une ressource partagée de campement, feature 20) : aucune notion de
  // prix — rendu volontairement laissé identique à avant cette extension, jamais touché.
  if (mode === "resource") {
    return (
      <form onSubmit={handleSubmit} noValidate className="contents">
        <Modal.Header>
          <Modal.Heading>{selectedDate}</Modal.Heading>
        </Modal.Header>
        <Modal.Body>
          <div className="flex flex-col gap-4">
            <CapacityField value={capacityInput} onChange={setCapacityInput} />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit" isDisabled={isSubmitting} data-testid="save-availability-button">
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </Modal.Footer>
      </form>
    );
  }

  // Mode "product" : deux formulaires indépendants dans le même dialog (cupo+abierto, precio
  // especial) — jamais imbriqués (HTML n'autorise pas un <form> dans un <form>) : Modal.Header hors
  // formulaire, chaque formulaire porte son propre bouton de soumission dans Modal.Body, pas de
  // Modal.Footer partagé entre eux.
  return (
    <>
      <Modal.Header>
        <Modal.Heading>{selectedDate}</Modal.Heading>
      </Modal.Header>
      <Modal.Body>
        <div className="flex flex-col gap-6">
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <CapacityField value={capacityInput} onChange={setCapacityInput} />
            <Switch isSelected={openInput} onChange={setOpenInput}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                {openInput ? "Abierto" : "Cerrado"}
              </Switch.Content>
            </Switch>
            {initialBooked > 0 ? (
              // Spec 17 §0 Tranche 1 — amélioration au-delà de la v1 (calendrier et Pedidos y sont
              // toujours restés deux écrans disjoints) : voir qui a réservé ce jour précis pour ce
              // produit, sans deviner une date/un produit dans le filtre de /admin/orders à la main.
              <Link
                href={`/admin/orders?product_id=${entityId}&date_from=${selectedDate}&date_to=${selectedDate}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
                data-testid="view-day-orders-link"
              >
                Ver reservas de este día ({initialBooked})
              </Link>
            ) : null}
            <Button
              type="submit"
              size="sm"
              isDisabled={isSubmitting}
              data-testid="save-availability-button"
            >
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </form>

          <form
            onSubmit={handlePriceSubmit}
            noValidate
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="date-rate-price">Precio especial (COP) — vacío = precio normal</Label>
              <Input
                id="date-rate-price"
                name="date-rate-price"
                type="number"
                min={0}
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              isDisabled={isSavingPrice}
              data-testid="save-date-rate-button"
            >
              {isSavingPrice ? "Guardando…" : "Guardar precio"}
            </Button>
          </form>
        </div>
      </Modal.Body>
    </>
  );
}

export function AvailabilityCalendar({
  entityId,
  mode = "product",
  calendarDefaultOpen = true,
  availability,
  calendar = [],
  rates = [],
  defaultCapacity = null,
  groupDiscountThresholdQty = null,
}: {
  entityId: string;
  // Feature 20 : "resource" adapte le même composant à la clé établissement (ressource partagée
  // d'un camp, provider_resource_calendar → set_provider_resource_capacity) plutôt que produit
  // (product_availability → set_product_availability) — même écran, même geste admin, seule la clé
  // et la RPC cible changent. Aucune notion "open" pour une ressource partagée (juste une
  // capacité) : le Switch reste caché en mode "resource".
  mode?: "product" | "resource";
  calendarDefaultOpen?: boolean;
  availability: AvailabilityRow[];
  calendar?: CalendarRow[];
  // Spec 17 §0 Tranche 2 — product_date_rates, optionnel/vide par défaut : les appelants "resource"
  // (ex. apps/admin/app/admin/establishments/[id]/resource/page.tsx) ne fournissent jamais cette
  // prop, set_date_rate n'existant que pour p_entity_type='product'.
  rates?: RateRow[];
  // products.default_capacity (migration 20260818090000), optionnel/null par défaut : uniquement
  // pertinent en mode "product" — les appelants "resource" ne fournissent jamais cette prop (pas
  // de colonne équivalente pour une ressource partagée), exactement comme `rates` ci-dessus.
  defaultCapacity?: number | null;
  // Remise par seuil de remplissage cumulé (migration 20260914130000) — camp uniquement,
  // optionnel/null par défaut : les appelants "resource" ne le fournissent jamais (pas de colonne
  // équivalente sur provider_resource_calendar), même posture que `defaultCapacity` ci-dessus.
  // Permet à l'établissement de savoir, à l'arrivée, s'il doit appliquer la remise sur le solde
  // encaissé en espèces (cf. plan — le solde n'est pas suivi numériquement par Hifago).
  groupDiscountThresholdQty?: number | null;
}) {
  const router = useRouter();

  const availabilityByDate = useMemo(
    () => new Map(availability.map((row) => [row.date, row])),
    [availability]
  );
  const calendarByDate = useMemo(
    () => new Map(calendar.map((row) => [row.date, row.open])),
    [calendar]
  );
  const rateByDate = useMemo(() => new Map(rates.map((row) => [row.date, row.price_cop])), [rates]);

  // Bornes du mois actuellement affiché (mises à jour par FullCalendar via datesSet à chaque
  // navigation) — nécessaire pour afficher un badge sur CHAQUE jour visible, y compris ceux sans
  // aucune ligne en base (cf. plan : "chaque jour affiche son état").
  const [visibleRange, setVisibleRange] = useState<{ start: string; end: string } | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Mémorise la dernière date sélectionnée : le contenu du formulaire reste affiché pendant
  // l'animation de fermeture du Modal (isOpen passe à false avant le démontage), plutôt que de
  // disparaître instantanément dès que selectedDate repasse à null. Pattern React documenté
  // ("Adjusting state during rendering") plutôt qu'une ref : `react-hooks/refs` interdit toute
  // lecture/écriture de `.current` pendant le rendu.
  const [displayDate, setDisplayDate] = useState<string | null>(null);
  if (selectedDate !== null && selectedDate !== displayDate) {
    setDisplayDate(selectedDate);
  }

  function handleDatesSet(arg: DatesSetArg) {
    setVisibleRange({ start: arg.startStr.slice(0, 10), end: arg.endStr.slice(0, 10) });
  }

  function openFormFor(dateStr: string) {
    setSelectedDate(dateStr);
  }

  function handleDateClick(info: DateClickArg) {
    openFormFor(info.dateStr);
  }

  // Chaque jour affiche un badge (event) qui recouvre l'essentiel de la cellule (cf. plan :
  // "chaque jour affiche son état") — un clic y atterrit plus souvent que sur la cellule vide
  // elle-même, et FullCalendar ne route pas ce clic vers dateClick. Sans ce handler, le
  // formulaire ne s'ouvrirait quasiment jamais en pratique.
  function handleEventClick(info: { event: { startStr: string } }) {
    openFormFor(info.event.startStr.slice(0, 10));
  }

  const events: EventInput[] = useMemo(() => {
    if (!visibleRange) return [];
    const items: EventInput[] = [];
    for (let dateStr = visibleRange.start; dateStr < visibleRange.end; dateStr = addDays(dateStr, 1)) {
      const status = statusFor(
        dateStr,
        availabilityByDate,
        calendarByDate,
        calendarDefaultOpen,
        defaultCapacity
      );
      let title = "Sin configurar";
      let className = "availability-badge availability-badge--unconfigured";
      if (status.kind === "closed") {
        title = "Cerrado";
        className = "availability-badge availability-badge--closed";
      } else if (status.kind === "configured") {
        title = `${status.booked}/${status.capacity}`;
        className = "availability-badge availability-badge--configured";
        // Remise par seuil de remplissage cumulé — jamais la seule couleur pour porter
        // l'information (ui.md) : le texte du badge lui-même change, pas seulement sa classe.
        if (groupDiscountThresholdQty !== null && status.booked >= groupDiscountThresholdQty) {
          title = `${status.booked}/${status.capacity} · Descuento activo`;
          className += " availability-badge--discount-reached";
        }
      } else if (status.kind === "default") {
        title = `Por defecto: ${status.capacity}`;
        className = "availability-badge availability-badge--default";
      }
      // Precio especial (product_date_rates) — affiché sous le badge cupo/estado, jamais à la
      // place : booked/capacity d'abord, prix en dessous. rateByDate reste vide en mode "resource"
      // (pas de prop `rates`) : aucun effet là-bas.
      const price = status.kind === "configured" ? rateByDate.get(dateStr) : undefined;
      items.push({
        start: dateStr,
        allDay: true,
        title,
        display: "list-item",
        classNames: [className],
        extendedProps: { price },
      });
    }
    return items;
  }, [
    visibleRange,
    availabilityByDate,
    calendarByDate,
    calendarDefaultOpen,
    defaultCapacity,
    rateByDate,
    groupDiscountThresholdQty,
  ]);

  function renderEventContent(arg: EventContentArg) {
    const price = arg.event.extendedProps.price as number | undefined;
    return (
      <div className="availability-badge-inner">
        <span>{arg.event.title}</span>
        {price ? (
          <span className="availability-badge-price">{price.toLocaleString("es-CO")}</span>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        height="auto"
        events={events}
        eventContent={renderEventContent}
        datesSet={handleDatesSet}
        dateClick={handleDateClick}
        eventClick={handleEventClick}
      />

      <Modal>
        <Modal.Backdrop
          isOpen={selectedDate !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedDate(null);
          }}
        >
          <Modal.Container>
            <Modal.Dialog>
              <Modal.CloseTrigger />
              {displayDate !== null ? (
                <AvailabilityFormFields
                  key={displayDate}
                  selectedDate={displayDate}
                  entityId={entityId}
                  mode={mode}
                  initialCapacity={(() => {
                    const row = availabilityByDate.get(displayDate);
                    if (row) return String(row.capacity);
                    // Aucune ligne explicite pour ce jour : pré-remplit avec default_capacity
                    // (au lieu d'un champ vide) pour qu'un admin qui clique un jour "par défaut"
                    // voie déjà la bonne valeur et puisse juste l'ajuster puis Guardar pour créer
                    // une exception ciblée.
                    return defaultCapacity !== null ? String(defaultCapacity) : "";
                  })()}
                  initialOpen={calendarByDate.get(displayDate) ?? calendarDefaultOpen}
                  initialBooked={availabilityByDate.get(displayDate)?.booked ?? 0}
                  initialPrice={(() => {
                    const price = rateByDate.get(displayDate);
                    return price ? String(price) : "";
                  })()}
                  onSaved={() => {
                    setSelectedDate(null);
                    router.refresh();
                  }}
                />
              ) : null}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
