"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, toast } from "@hifago/ui";
import { mountAddressAutocomplete } from "@/components/address-autocomplete";

// Revue admin partenaires (Jérôme, 2026-08-19) — seul point de saisie d'une localisation
// partenaire APRÈS création (set_partner_location, jamais exposé avant ce lot — seule
// create_partner_direct écrivait address/lat/lon, une seule fois, à la création). Nécessaire pour
// que le filtre "Buscar ubicación" de la liste ait un jour des données à filtrer : 31/32
// partenaires n'ont aujourd'hui aucune ligne partner_crm_profile. Calqué sur
// EstablishmentEditBlock.tsx (même widget Google, même repli manuel lat/lon).
export function PartnerLocationBlock({
  partnerId,
  initialAddress,
  initialLat,
  initialLon,
}: {
  partnerId: string;
  initialAddress: string;
  initialLat: string;
  initialLon: string;
}) {
  const router = useRouter();

  const [address, setAddress] = useState(initialAddress);
  const [lat, setLat] = useState(initialLat);
  const [lon, setLon] = useState(initialLon);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addressSearchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = addressSearchRef.current;
    if (!container) return;
    return mountAddressAutocomplete(container, (place) => {
      setAddress(place.address);
      if (place.lat !== null && place.lon !== null) {
        setLat(String(place.lat));
        setLon(String(place.lon));
      }
    });
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("set_partner_location", {
      p_partner_id: partnerId,
      p_address: address.trim() || undefined,
      p_lat: lat.trim() ? Number(lat) : undefined,
      p_lon: lon.trim() ? Number(lon) : undefined,
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean } | null;
    if (rpcError || !result?.ok) {
      toast.danger("No se pudo actualizar la ubicación.");
      return;
    }

    toast.success("Ubicación actualizada.");
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-surface p-4" data-testid="partner-location-block">
      <h2 className="mb-4 text-sm font-medium">Ubicación</h2>

      <form onSubmit={handleSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="partner-address-search">Buscar dirección (Google)</Label>
          <div id="partner-address-search" ref={addressSearchRef} data-testid="partner-address-search" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="partner-address">Dirección</Label>
          <Input
            id="partner-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            data-testid="partner-address-input"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="partner-lat">Latitud</Label>
            <Input
              id="partner-lat"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              data-testid="partner-lat-input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="partner-lon">Longitud</Label>
            <Input
              id="partner-lon"
              value={lon}
              onChange={(event) => setLon(event.target.value)}
              data-testid="partner-lon-input"
            />
          </div>
        </div>

        <Button type="submit" isDisabled={isSubmitting} data-testid="save-partner-location-button">
          {isSubmitting ? "Guardando…" : "Guardar ubicación"}
        </Button>
      </form>
    </div>
  );
}
