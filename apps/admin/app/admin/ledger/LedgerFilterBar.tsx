"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, ListBox, Select, buttonVariants } from "@hifago/ui";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from "@/lib/lists/filters";
import { LEDGER_STATUS_LABELS } from "./ledgerStatusLabels";

export type ReferrerOption = { id: string; name: string };
export type EstablishmentOption = { id: string; name: string };

export type LedgerFilterBarProps = {
  values: Record<string, string>;
  hiddenParams?: Record<string, string>;
  referrers: ReferrerOption[];
  establishments: EstablishmentOption[];
};

// Refonte /admin/ledger (DataList) — remplace LEDGER_FILTERS/ServerFilters générique : "Referente"
// et "Establecimiento" ont besoin d'un combobox avec recherche (SearchableCombobox, même patron que
// "Actividad" sur ReservationsFilterBar.tsx), pas juste un texte libre ou un <select> plafonné —
// ServerFilters ne connaît que text/select/date. Soumission interceptée en JS (router.push) plutôt
// qu'un <form method="GET"> natif, pour injecter referrer_partner_id/establishment_id (état React
// des combobox, jamais des inputs natifs nommés) aux côtés des champs classiques lus depuis
// FormData.
export function LedgerFilterBar({ values, hiddenParams, referrers, establishments }: LedgerFilterBarProps) {
  const router = useRouter();
  const [referrerPartnerId, setReferrerPartnerId] = useState<string | null>(
    values.referrer_partner_id ?? null
  );
  const [establishmentId, setEstablishmentId] = useState<string | null>(values.establishment_id ?? null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    const dateFrom = String(formData.get("date_from") ?? "").trim();
    if (dateFrom) params.set("date_from", dateFrom);
    const dateTo = String(formData.get("date_to") ?? "").trim();
    if (dateTo) params.set("date_to", dateTo);
    const status = String(formData.get("status") ?? "").trim();
    if (status) params.set("status", status);
    const type = String(formData.get("type") ?? "").trim();
    if (type) params.set("type", type);
    if (referrerPartnerId) params.set("referrer_partner_id", referrerPartnerId);
    if (establishmentId) params.set("establishment_id", establishmentId);

    for (const [name, value] of Object.entries(hiddenParams ?? {})) {
      params.set(name, value);
    }

    router.push(`/admin/ledger?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4" data-testid="ledger-filter-bar">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="date_from">Desde</Label>
        <Input
          id="date_from"
          name="date_from"
          type="date"
          defaultValue={values.date_from ?? ""}
          data-testid="filter-date_from"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="date_to">Hasta</Label>
        <Input
          id="date_to"
          name="date_to"
          type="date"
          defaultValue={values.date_to ?? ""}
          data-testid="filter-date_to"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Select name="status" defaultSelectedKey={values.status ?? ""}>
          <Label>Estado</Label>
          <Select.Trigger data-testid="filter-status">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="" textValue="Todos los estados">
                Todos los estados
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {Object.entries(LEDGER_STATUS_LABELS).map(([value, label]) => (
                <ListBox.Item key={value} id={value} textValue={label}>
                  {label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Select name="type" defaultSelectedKey={values.type ?? ""}>
          <Label>Tipo</Label>
          <Select.Trigger data-testid="filter-type">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="" textValue="Todos los tipos">
                Todos los tipos
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {PRODUCT_TYPES.map((type) => (
                <ListBox.Item key={type} id={type} textValue={PRODUCT_TYPE_LABELS[type]}>
                  {PRODUCT_TYPE_LABELS[type]}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className="w-56">
        <SearchableCombobox
          items={referrers}
          getKey={(referrer) => referrer.id}
          getLabel={(referrer) => referrer.name}
          value={referrerPartnerId}
          onChange={setReferrerPartnerId}
          label="Referente"
          placeholder="Buscar referente…"
          testId="filter-referrer_partner_id"
        />
      </div>

      <div className="w-56">
        <SearchableCombobox
          items={establishments}
          getKey={(establishment) => establishment.id}
          getLabel={(establishment) => establishment.name}
          value={establishmentId}
          onChange={setEstablishmentId}
          label="Establecimiento"
          placeholder="Buscar establecimiento…"
          testId="filter-establishment_id"
        />
      </div>

      <button type="submit" className={buttonVariants()} data-testid="server-filters-submit">
        Buscar
      </button>
    </form>
  );
}
