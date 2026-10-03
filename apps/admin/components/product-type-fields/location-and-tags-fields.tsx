"use client";

import { Input, Label } from "@hifago/ui";
import { useAddressAutocomplete } from "@/components/use-address-autocomplete";
import type { ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Extrait de product-type-fields.tsx (découpage des god components, 2026-09-17) — rendu quand
// `hasLocationAndTags` (activity/lodging — le trio générique adresse/lat/lon, PAS transport, qui a
// ses propres colonnes `transport_departure_*`/`transport_arrival_*` depuis le 2026-09-16, cf.
// TransportFields.tsx). Nom conservé malgré le "AndTags" trompeur : `hasTags` est un booléen
// distinct depuis le 2026-08-18 (productTypeGating.ts) — renommage cosmétique laissé de côté
// volontairement lors du découpage, comme documenté là-bas.
export function LocationAndTagsFields({ state }: { state: ProductTypeFieldsState }) {
  const addressSearchRef = useAddressAutocomplete((place) => {
    state.setAddress(place.address);
    if (place.lat !== null && place.lon !== null) {
      state.setLat(String(place.lat));
      state.setLon(String(place.lon));
    }
  });

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address-search">Buscar dirección (Google) — opcional</Label>
        <div id="address-search" ref={addressSearchRef} data-testid="address-search" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Dirección</Label>
        <Input
          id="address"
          value={state.address}
          onChange={(event) => state.setAddress(event.target.value)}
          placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
          data-testid="address-input"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lat">Latitud — detectada o manual</Label>
          <Input id="lat" value={state.lat} onChange={(event) => state.setLat(event.target.value)} data-testid="lat-input" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lon">Longitud — detectada o manual</Label>
          <Input id="lon" value={state.lon} onChange={(event) => state.setLon(event.target.value)} data-testid="lon-input" />
        </div>
      </div>
    </>
  );
}
