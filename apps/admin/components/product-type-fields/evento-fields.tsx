"use client";

import { Checkbox, Input, Label, ListBox, Select, Switch, TextField } from "@hifago/ui";
import type { ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// apps/admin n'est pas localisé (hifago/CLAUDE.md §2 point 1) — locale "es" fixe, même convention
// que tout le reste de ce formulaire (labels en dur, pas de next-intl).
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("es", { weekday: "long" });

// Confirme sur quel jour de semaine tombe la première occurrence d'un evento récurrent — sans ça,
// "cada 14 días" ne dit jamais si c'est un mardi ou un jeudi (gap réel signalé par Jérôme,
// 2026-08-18). Le jour de semaine n'est mathématiquement garanti stable d'une occurrence à l'autre
// que si la fréquence est un multiple de 7 (sinon la récurrence glisse de jour en jour) — dans ce
// cas seulement, le texte précise explicitement "se repetirá cada {jour}".
function occurrenceWeekdayHint(occurrenceDate: string, recurrenceFrequencyDays: string): string {
  const weekday = WEEKDAY_FORMATTER.format(new Date(`${occurrenceDate}T00:00:00`));
  const days = Number(recurrenceFrequencyDays);
  if (Number.isInteger(days) && days > 0 && days % 7 === 0) {
    const weeks = days / 7;
    return `Cae en ${weekday} — se repetirá cada ${weekday} (cada ${weeks === 1 ? "semana" : `${weeks} semanas`}).`;
  }
  return `Cae en ${weekday}.`;
}

// Extrait de product-type-fields.tsx (découpage des god components, 2026-09-17) — SEUL bloc rendu
// pour `type === "evento"`. Composant purement contrôlé (state vient de useProductTypeFieldsState),
// aucune logique déplacée : miroir exact du bloc `isEvento` d'origine, même conditions, même ordre.
export function EventoFields({
  state,
  section,
  allowOnlineBookableConfig = false,
}: {
  state: ProductTypeFieldsState;
  // Assistant par étapes (docs/specs/40) — le bloc réservation/tarification (switch, capacité,
  // precio, modo de pago, precio-texto-libre) EST la « pricing » d'evento (son seul équivalent à
  // VitrineFields, absente pour ce type) ; ocurrencia/horario restent « details » (des faits
  // descriptifs — quand est-ce que ça a lieu). Les deux étaient rendus l'un après l'autre sans
  // condition, jamais séparés avant ce chantier.
  section?: "details" | "pricing";
  // Evento réservable en ligne (2026-09-15) — décision produit « admin uniquement » : un socio ne
  // doit jamais pouvoir rendre un evento réservable-payant via le circuit de proposition. Le
  // blocage réel vit côté RPC (whitelist de submit_product_creation_proposal/
  // create_product_from_proposal, qui ignorent silencieusement ces colonnes) — cette prop n'est
  // qu'une défense en profondeur côté écran, pas le vrai rempart.
  allowOnlineBookableConfig?: boolean;
}) {
  // Le discriminant du bloc de CONFIGURATION : configurable ICI (admin) ET effectivement basculé.
  // Le libellé de prix vitrine, lui, ne dépend que de `state.onlineBookable` (2026-10-13) : un
  // evento réservable n'en a jamais, que l'écran sache le configurer ou non — nier cette
  // conjonction-ci l'affichait à tort sur les écrans socio et modération.
  const eventoReservableEnLinea = allowOnlineBookableConfig && state.onlineBookable;
  const showDetails = !section || section === "details";
  const showPricing = !section || section === "pricing";

  return (
    <>
      {showPricing && allowOnlineBookableConfig ? (
        <Switch
          isSelected={state.onlineBookable}
          onChange={state.setOnlineBookable}
          data-testid="online-bookable-switch"
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            {state.onlineBookable ? "Reservable en línea" : "Vitrina (no reservable en línea)"}
          </Switch.Content>
        </Switch>
      ) : null}

      {showPricing && eventoReservableEnLinea ? (
        <>
          <Select
            fullWidth
            value={state.eventoCapacityMode}
            onChange={(value) =>
              value && state.setEventoCapacityMode(value as "unlimited" | "metered" | "rsvp")
            }
          >
            <Label>Modo de capacidad</Label>
            <Select.Trigger data-testid="evento-capacity-mode-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="unlimited" textValue="Plazas ilimitadas">
                  Plazas ilimitadas — nunca bloquea, sin contador
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="metered" textValue="Cupo con descuento automático">
                  Cupo con descuento automático — bloquea al llenarse
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="rsvp" textValue="Aforo informativo con contador">
                  Aforo informativo con contador — nunca bloquea
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>

          {state.eventoCapacityMode === "metered" || state.eventoCapacityMode === "rsvp" ? (
            <TextField
              fullWidth
              name="evento-default-capacity"
              value={state.defaultCapacity}
              onChange={state.setDefaultCapacity}
              isRequired
            >
              <Label>
                {state.eventoCapacityMode === "metered"
                  ? "Cupo máximo — bloquea nuevas reservas al llenarse"
                  : "Aforo informativo — nunca bloquea, solo se muestra como contador"}
              </Label>
              <Input type="number" min={1} data-testid="evento-default-capacity-input" />
            </TextField>
          ) : null}

          <Checkbox
            isSelected={state.isFree}
            onChange={state.setIsFree}
            data-testid="evento-is-free-checkbox"
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              Evento gratuito
            </Checkbox.Content>
          </Checkbox>

          {!state.isFree ? (
            <>
              <TextField
                fullWidth
                name="evento-price"
                value={state.priceCop}
                onChange={state.setPriceCop}
                isRequired
              >
                <Label>Precio (COP)</Label>
                <Input type="number" min={1} data-testid="evento-price-input" />
              </TextField>

              <Select
                fullWidth
                value={state.eventoPaymentMode}
                onChange={(value) => value && state.setEventoPaymentMode(value as "online" | "on_site")}
              >
                <Label>Modo de pago</Label>
                <Select.Trigger data-testid="evento-payment-mode-select">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="online" textValue="Pago en línea">
                      Pago en línea (Mercado Pago)
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="on_site" textValue="Pago en el establecimiento">
                      Pago en el establecimiento
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </>
          ) : null}

          <Checkbox
            isSelected={state.eventoOccupiesResource}
            onChange={state.setEventoOccupiesResource}
            data-testid="evento-occupies-resource-checkbox"
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              Ocupa el recurso compartido del establecimiento (bloquea campamentos/otros eventos
              reservables ese día)
            </Checkbox.Content>
          </Checkbox>
        </>
      ) : null}

      {/* Evento réservable en ligne vu depuis un écran qui ne le configure pas (socio, modération) :
          on le DIT, au lieu d'afficher un « Precio (texto libre) » vide. Ce champ-là n'a pas de sens
          ici — `price_cop` fait foi — et ce qu'on y saisissait était écarté à l'approbation. */}
      {showPricing && state.onlineBookable && !allowOnlineBookableConfig ? (
        <p className="text-sm text-muted" data-testid="evento-online-bookable-note">
          Evento reservable en línea: el precio, el aforo y el modo de pago los gestiona el equipo
          de Hifago.
        </p>
      ) : null}

      {showPricing && !state.onlineBookable ? (
        <TextField
          fullWidth
          name="price-label"
          value={state.priceLabel}
          onChange={state.setPriceLabel}
          isRequired
        >
          <Label>Precio (texto libre)</Label>
          <Input
            placeholder="Ej. Desde $50.000 COP, entrada gratuita…"
            data-testid="price-label-input"
          />
        </TextField>
      ) : null}

      {showDetails ? (
        <>
          <Select
            fullWidth
            value={state.occurrenceType}
            onChange={(value) => value && state.setOccurrenceType(value as "once" | "recurring")}
          >
            <Label>Ocurrencia</Label>
            <Select.Trigger data-testid="occurrence-type-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="once" textValue="Puntual">
                  Puntual
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="recurring" textValue="Recurrente">
                  Recurrente
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>

          {state.occurrenceType === "once" ? (
            <TextField
              fullWidth
              name="occurrence-date"
              value={state.occurrenceDate}
              onChange={state.setOccurrenceDate}
              isRequired
            >
              <Label>Fecha</Label>
              <Input type="date" data-testid="occurrence-date-input" />
            </TextField>
          ) : (
            <>
              {/* Fecha de la primera ocurrencia — ancre nécessaire pour savoir sur quel jour de la
                  semaine tombe la récurrence (ex. "cada 14 días" à partir d'un martes = un evento
                  tous les 2 mardis) : sans cette date, ce jour n'est mathématiquement pas
                  déterminable. Gap réel signalé par Jérôme (2026-08-18) : occurrence_date n'était
                  jusqu'ici collectée que pour occurrenceType="once". */}
              <TextField
                fullWidth
                name="occurrence-date"
                value={state.occurrenceDate}
                onChange={state.setOccurrenceDate}
                isRequired
              >
                <Label>Fecha de la primera ocurrencia</Label>
                <Input type="date" data-testid="occurrence-date-input" />
              </TextField>
              {state.occurrenceDate ? (
                <p className="text-xs text-muted" data-testid="occurrence-weekday-hint">
                  {occurrenceWeekdayHint(state.occurrenceDate, state.recurrenceFrequencyDays)}
                </p>
              ) : null}
              <TextField
                fullWidth
                name="recurrence-frequency"
                value={state.recurrenceFrequencyDays}
                onChange={state.setRecurrenceFrequencyDays}
                isRequired
              >
                <Label>Frecuencia (días)</Label>
                <Input type="number" min={1} data-testid="recurrence-frequency-input" />
              </TextField>
              <Select
                fullWidth
                value={state.recurrenceEndKind}
                onChange={(value) => value && state.setRecurrenceEndKind(value as "date" | "count" | "none")}
              >
                <Label>Fin de la recurrencia</Label>
                <Select.Trigger data-testid="recurrence-end-select">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="none" textValue="Indefinida">
                      Indefinida
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="date" textValue="Hasta una fecha">
                      Hasta una fecha
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="count" textValue="Número de repeticiones">
                      Número de repeticiones
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              {state.recurrenceEndKind === "date" ? (
                <TextField
                  fullWidth
                  name="recurrence-end-date"
                  value={state.recurrenceEndDate}
                  onChange={state.setRecurrenceEndDate}
                  isRequired
                >
                  <Label>Fecha de fin</Label>
                  <Input type="date" data-testid="recurrence-end-date-input" />
                </TextField>
              ) : null}
              {state.recurrenceEndKind === "count" ? (
                <TextField
                  fullWidth
                  name="recurrence-end-count"
                  value={state.recurrenceEndCount}
                  onChange={state.setRecurrenceEndCount}
                  isRequired
                >
                  <Label>Número de repeticiones</Label>
                  <Input type="number" min={1} data-testid="recurrence-end-count-input" />
                </TextField>
              ) : null}
            </>
          )}

          <TextField fullWidth name="start-time" value={state.startTime} onChange={state.setStartTime}>
            <Label>Hora de inicio — opcional</Label>
            <Input type="time" />
          </TextField>
          <TextField
            fullWidth
            name="duration"
            value={state.durationMinutes}
            onChange={state.setDurationMinutes}
          >
            <Label>Duración (minutos) — opcional</Label>
            <Input type="number" min={1} />
          </TextField>
        </>
      ) : null}
    </>
  );
}
