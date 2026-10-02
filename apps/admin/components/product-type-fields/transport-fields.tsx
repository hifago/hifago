"use client";

import { Input, Label, TextField } from "@hifago/ui";
import { useAddressAutocomplete } from "@/components/use-address-autocomplete";
import type { TransportInfoFields } from "@/lib/products/transportInfo";
import type { ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Extrait de product-type-fields.tsx (découpage des god components, 2026-09-17) — SEUL bloc rendu
// pour `type === "transport"` (horaires et lieux, PUREMENT INFORMATIFS, migration 20260916150000,
// demande Jérôme du 2026-09-16 : « c'est à titre informatif pour la personne qui réserve »).
// ⚠️ La fenêtre de départs n'est PAS un créneau réservable : aucun `product_slot_rules` ici, cette
// table-là rendrait `create_order` bloquant (refus `slot_required`). Un transport reste réservé par
// DATE, et son cupo réel est « Cupo diario por defecto » (hasDefaultCapacity, dans le fichier hôte).
// Le lieu de départ vit dans `transport_departure_*`, pas dans le trio générique
// `address`/`lat`/`lon` (retiré d'`hasLocationAndTags` pour ce type) : un trajet a DEUX extrémités,
// et une seule convention de nommage doit porter un seul concept.
export function TransportFields({ state }: { state: ProductTypeFieldsState }) {
  // Forme FONCTIONNELLE du setter (`(prev) => …`), pas `{ ...state.transportInfo, … }` : le
  // callback du widget Google arrive de façon asynchrone, longtemps après le render qui l'a monté,
  // et fermerait sinon sur un `transportInfo` périmé.
  const setTransport = (patch: Partial<TransportInfoFields>) =>
    state.setTransportInfo((prev) => ({ ...prev, ...patch }));

  // ⚠️ DEUX refs distinctes (un `useAddressAutocomplete` chacune), jamais une seule mutualisée :
  // un ref unique serait écrasé par le dernier `<div ref>` rendu, donc un widget se monterait dans
  // le mauvais conteneur.
  const departureSearchRef = useAddressAutocomplete(
    (place) => {
      setTransport({
        departureAddress: place.address,
        ...(place.lat !== null && place.lon !== null
          ? { departureLat: String(place.lat), departureLon: String(place.lon) }
          : {}),
      });
    },
    {
      testId: "departure-address-autocomplete",
      ariaLabel: "Lugar de salida",
      placeholder: "Empieza a escribir el lugar de salida…",
    },
  );

  const arrivalSearchRef = useAddressAutocomplete(
    (place) => {
      setTransport({
        arrivalAddress: place.address,
        ...(place.lat !== null && place.lon !== null
          ? { arrivalLat: String(place.lat), arrivalLon: String(place.lon) }
          : {}),
      });
    },
    {
      testId: "arrival-address-autocomplete",
      ariaLabel: "Lugar de llegada",
      placeholder: "Empieza a escribir el lugar de llegada…",
    },
  );

  return (
    <>
      {/* LE CONTACT, en premier : c'est par là que le voyageur réserve un trajet. Un transport n'a
          plus de calendrier ni de panier (décision Jérôme du 2026-09-17) — sa fiche publique
          affiche un bouton WhatsApp à la place. Champ OPTIONNEL : vide, c'est le WhatsApp de
          Hifago qui répond, jamais un bouton mort. */}
      <div className="flex flex-col gap-1.5">
        <TextField
          fullWidth
          name="transport-contact-phone"
          value={state.transportInfo.contactPhone}
          onChange={(value) => setTransport({ contactPhone: value })}
        >
          <Label>Teléfono de contacto (WhatsApp) — opcional</Label>
          <Input
            type="tel"
            placeholder="+573001112233"
            data-testid="transport-contact-phone-input"
          />
        </TextField>
        <p className="text-xs text-muted" data-testid="transport-contact-phone-help">
          Formato internacional, con el indicativo del país. Si lo dejas vacío, la ficha pública
          muestra el WhatsApp de Hifago. Un transporte no se reserva en línea: el viajero escribe
          por WhatsApp.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="departure-address-search">Lugar de salida — buscar (Google), opcional</Label>
        <div id="departure-address-search" ref={departureSearchRef} data-testid="departure-address-search" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="departure-address">Lugar de salida</Label>
        <Input
          id="departure-address"
          value={state.transportInfo.departureAddress}
          onChange={(event) => setTransport({ departureAddress: event.target.value })}
          placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
          data-testid="departure-address-input"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="departure-lat">Latitud de salida — detectada o manual</Label>
          <Input
            id="departure-lat"
            value={state.transportInfo.departureLat}
            onChange={(event) => setTransport({ departureLat: event.target.value })}
            data-testid="departure-lat-input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="departure-lon">Longitud de salida — detectada o manual</Label>
          <Input
            id="departure-lon"
            value={state.transportInfo.departureLon}
            onChange={(event) => setTransport({ departureLon: event.target.value })}
            data-testid="departure-lon-input"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="arrival-address-search">Lugar de llegada — buscar (Google), opcional</Label>
        <div id="arrival-address-search" ref={arrivalSearchRef} data-testid="arrival-address-search" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="arrival-address">Lugar de llegada</Label>
        <Input
          id="arrival-address"
          value={state.transportInfo.arrivalAddress}
          onChange={(event) => setTransport({ arrivalAddress: event.target.value })}
          placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
          data-testid="arrival-address-input"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="arrival-lat">Latitud de llegada — detectada o manual</Label>
          <Input
            id="arrival-lat"
            value={state.transportInfo.arrivalLat}
            onChange={(event) => setTransport({ arrivalLat: event.target.value })}
            data-testid="arrival-lat-input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="arrival-lon">Longitud de llegada — detectada o manual</Label>
          <Input
            id="arrival-lon"
            value={state.transportInfo.arrivalLon}
            onChange={(event) => setTransport({ arrivalLon: event.target.value })}
            data-testid="arrival-lon-input"
          />
        </div>
      </div>

      {/* `first = last` est VALIDE, et c'est le cas normal d'un transfert à heure fixe — d'où le
          `>=` du CHECK products_transport_departure_order, divergence assumée avec
          product_slot_rules_time_order (qui exige, lui, un intervalle strict). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField
          fullWidth
          name="transport-first-departure"
          value={state.transportInfo.firstDepartureTime}
          onChange={(value) => setTransport({ firstDepartureTime: value })}
        >
          <Label>Primera salida — opcional</Label>
          <Input type="time" data-testid="transport-first-departure-input" />
        </TextField>
        <TextField
          fullWidth
          name="transport-last-departure"
          value={state.transportInfo.lastDepartureTime}
          onChange={(value) => setTransport({ lastDepartureTime: value })}
        >
          <Label>Última salida — opcional</Label>
          <Input type="time" data-testid="transport-last-departure-input" />
        </TextField>
      </div>
      <div className="flex flex-col gap-1.5">
        <TextField
          fullWidth
          name="transport-seats"
          value={state.transportInfo.seatsPerDeparture}
          onChange={(value) => setTransport({ seatsPerDeparture: value })}
        >
          <Label>Plazas por salida — opcional</Label>
          <Input type="number" min={1} data-testid="transport-seats-input" />
        </TextField>
        <p className="text-xs text-muted" data-testid="transport-seats-help">
          Solo informativo: se muestra en la ficha pública y nunca bloquea una reserva. El cupo que
          sí bloquea es «Cupo diario por defecto» más abajo.
        </p>
      </div>
    </>
  );
}
