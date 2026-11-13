"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, ListBox, Select, buttonVariants } from "@hifago/ui";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from "@/lib/lists/filters";
import { LEDGER_STATUS_LABELS } from "./ledgerStatusLabels";

export type BeneficiaryOption = { id: string; name: string };
export type EstablishmentOption = { id: string; name: string };

export type LedgerFilterBarProps = {
  values: Record<string, string>;
  hiddenParams?: Record<string, string>;
  beneficiaries: BeneficiaryOption[];
  establishments: EstablishmentOption[];
};

// Refonte /admin/ledger (DataList) — remplace LEDGER_FILTERS/ServerFilters générique : "Referente"
// et "Establecimiento" ont besoin d'un combobox avec recherche (SearchableCombobox, même patron que
// "Actividad" sur ReservationsFilterBar.tsx), pas juste un texte libre ou un <select> plafonné —
// ServerFilters ne connaît que text/select/date. Soumission interceptée en JS (router.push) plutôt
// qu'un <form method="GET"> natif, pour injecter beneficiary_partner_id/establishment_id (état React
// des combobox, jamais des inputs natifs nommés) aux côtés des champs classiques lus depuis
// FormData.
// Révision 20261112190000 : « Referente » devient « Beneficiario » (beneficiary_partner_id) — le
// partenaire à payer, référent ou partenaire de l'établissement compensé : un filtre référent ne
// retrouvait jamais une compensation d'annulation.
export function LedgerFilterBar({ values, hiddenParams, beneficiaries, establishments }: LedgerFilterBarProps) {
  const router = useRouter();
  const [beneficiaryPartnerId, setBeneficiaryPartnerId] = useState<string | null>(
    values.beneficiary_partner_id ?? null
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
    if (beneficiaryPartnerId) params.set("beneficiary_partner_id", beneficiaryPartnerId);
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
          items={beneficiaries}
          getKey={(beneficiary) => beneficiary.id}
          getLabel={(beneficiary) => beneficiary.name}
          value={beneficiaryPartnerId}
          onChange={setBeneficiaryPartnerId}
          label="Beneficiario"
          placeholder="Buscar beneficiario…"
          testId="filter-beneficiary_partner_id"
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
