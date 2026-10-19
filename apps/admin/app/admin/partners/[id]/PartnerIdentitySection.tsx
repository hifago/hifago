"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, ListBox, Select, TextArea, TextField, toast } from "@hifago/ui";
import { COMMERCIAL_STATUS_LABELS, commercialStatusLabel, type CommercialStatus } from "@/lib/partners/crmProfile";
import {
  buildProfileChanges,
  parseTags,
  socialHref,
  type BankDraft,
  type PartnerProfile,
  type PartnerTextField,
} from "@/lib/partners/partnerProfile";

// Identité, contact, réseaux et profil commercial d'un socio — lus, puis modifiables sur place par
// l'admin (« Editar », demande Jérôme du 2026-10-19) via admin_update_partner_profile
// (20261019160000) : un seul appel atomique et audité pour les deux tables. Le moyen de paiement
// arrive déjà résumé (suffixe seul, calculé côté serveur par la page) : il se remplace ou s'efface,
// il ne se relit jamais. L'adresse garde son bloc (PartnerLocationBlock, widget Google).

const REASON_MESSAGES: Record<string, string> = {
  not_found: "Este socio ya no existe.",
  invalid_name: "El nombre es obligatorio.",
  invalid_email: "El email no es válido.",
  invalid_commercial_status: "Estado comercial no válido.",
  invalid_bank: "Elige un solo método de pago.",
  too_long: "Un campo es demasiado largo.",
};

const TEXT_LABELS: Record<PartnerTextField, string> = {
  display_name: "Nombre",
  legal_name: "Razón social",
  identification_type: "Tipo de identificación",
  identification_number: "Número de identificación",
  partner_city: "Ciudad",
  email: "Email",
  phone: "Teléfono",
  instagram: "Instagram",
  facebook: "Facebook",
  website: "Sitio web",
  barrio: "Barrio",
  notes: "Notas",
};

function Item({ label, children, testId }: { label: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words" data-testid={testId}>
        {children || "—"}
      </dd>
    </div>
  );
}

function SocialLink({ network, value }: { network: "instagram" | "facebook" | "website"; value: string }) {
  const href = socialHref(network, value);
  if (!href) return <>{value}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
      {value}
    </a>
  );
}

function TextInput({
  field,
  value,
  onChange,
  type,
  placeholder,
}: {
  field: PartnerTextField;
  value: string;
  onChange: (value: string) => void;
  type?: "email" | "tel" | "url";
  placeholder?: string;
}) {
  const id = `partner-edit-${field}`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{TEXT_LABELS[field]}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        data-testid={`${id}-input`}
      />
    </div>
  );
}

export function PartnerIdentitySection({
  partnerId,
  profile,
  paymentMethodSummary,
}: {
  partnerId: string;
  profile: PartnerProfile;
  /** Résumé masqué (resumenMetodoPago), jamais le numéro. */
  paymentMethodSummary: string | null;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<PartnerProfile>(profile);
  const [bank, setBank] = useState<BankDraft>({ action: "keep" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setField = (field: PartnerTextField) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  function startEditing() {
    setDraft(profile);
    setBank({ action: "keep" });
    setIsEditing(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.display_name.trim()) {
      toast.danger(REASON_MESSAGES.invalid_name);
      return;
    }

    const changes = buildProfileChanges(profile, draft, bank);
    if (Object.keys(changes).length === 0) {
      setIsEditing(false);
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("admin_update_partner_profile", {
      p_partner_id: partnerId,
      p_changes: changes,
    });
    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        (result?.reason && REASON_MESSAGES[result.reason]) ?? "No se pudieron guardar los cambios.",
      );
      return;
    }

    toast.success("Ficha actualizada.");
    setIsEditing(false);
    router.refresh();
  }

  if (!isEditing) {
    const tags = parseTags(profile.tags);
    return (
      <section className="flex flex-col gap-4" data-testid="partner-identity-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Identidad y contacto</h2>
          <Button size="sm" variant="outline" onPress={startEditing} data-testid="partner-identity-edit-button">
            Editar
          </Button>
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <Item label="Email" testId="partner-email">
            {profile.email ? (
              <a href={`mailto:${profile.email}`} className="underline">
                {profile.email}
              </a>
            ) : null}
          </Item>
          <Item label="Teléfono" testId="partner-phone">
            {profile.phone ? (
              <a href={`tel:${profile.phone}`} className="underline">
                {profile.phone}
              </a>
            ) : null}
          </Item>
          <Item label="Instagram" testId="partner-instagram">
            {profile.instagram ? <SocialLink network="instagram" value={profile.instagram} /> : null}
          </Item>
          <Item label="Facebook" testId="partner-facebook">
            {profile.facebook ? <SocialLink network="facebook" value={profile.facebook} /> : null}
          </Item>
          <Item label="Sitio web" testId="partner-website">
            {profile.website ? <SocialLink network="website" value={profile.website} /> : null}
          </Item>
          <Item label="Razón social" testId="partner-legal-name">{profile.legal_name}</Item>
          <Item label="Identificación" testId="partner-identification">
            {[profile.identification_type, profile.identification_number].filter(Boolean).join(" ")}
          </Item>
          <Item label="Ciudad" testId="partner-city">{profile.partner_city}</Item>
          <Item label="Barrio" testId="partner-barrio">{profile.barrio}</Item>
          <Item label="Estado comercial" testId="partner-commercial-status">
            {commercialStatusLabel(profile.commercial_status)}
          </Item>
          <Item label="Método de pago" testId="partner-payment-method">{paymentMethodSummary}</Item>
          <Item label="Etiquetas" testId="partner-tags">{tags.join(", ")}</Item>
          <Item label="Notas" testId="partner-notes">
            {profile.notes ? <span className="whitespace-pre-line">{profile.notes}</span> : null}
          </Item>
        </dl>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-testid="partner-identity-section">
      <h2 className="text-lg font-medium">Identidad y contacto</h2>

      <form onSubmit={handleSubmit} noValidate className="flex max-w-2xl flex-col gap-6">
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-medium text-muted">Identidad</legend>
          <TextInput field="display_name" value={draft.display_name} onChange={setField("display_name")} />
          <TextInput field="legal_name" value={draft.legal_name} onChange={setField("legal_name")} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextInput
              field="identification_type"
              value={draft.identification_type}
              onChange={setField("identification_type")}
              placeholder="NIT, cédula…"
            />
            <TextInput
              field="identification_number"
              value={draft.identification_number}
              onChange={setField("identification_number")}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextInput field="partner_city" value={draft.partner_city} onChange={setField("partner_city")} />
            <TextInput field="barrio" value={draft.barrio} onChange={setField("barrio")} />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-medium text-muted">Contacto y redes</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextInput field="email" type="email" value={draft.email} onChange={setField("email")} />
            <TextInput field="phone" type="tel" value={draft.phone} onChange={setField("phone")} />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextInput
              field="instagram"
              value={draft.instagram}
              onChange={setField("instagram")}
              placeholder="@usuario o enlace"
            />
            <TextInput
              field="facebook"
              value={draft.facebook}
              onChange={setField("facebook")}
              placeholder="Página o enlace"
            />
          </div>
          <TextInput
            field="website"
            type="url"
            value={draft.website}
            onChange={setField("website")}
            placeholder="https://…"
          />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-medium text-muted">Perfil comercial</legend>
          <Select
            fullWidth
            value={draft.commercial_status}
            onChange={(value) =>
              value && setDraft((current) => ({ ...current, commercial_status: value as CommercialStatus }))
            }
          >
            <Label>Estado comercial</Label>
            <Select.Trigger data-testid="partner-edit-commercial-status-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {Object.entries(COMMERCIAL_STATUS_LABELS).map(([value, label]) => (
                  <ListBox.Item key={value} id={value} textValue={label}>
                    {label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="partner-edit-tags">Etiquetas — separadas por coma</Label>
            <Input
              id="partner-edit-tags"
              value={draft.tags}
              onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
              data-testid="partner-edit-tags-input"
            />
          </div>

          <TextField fullWidth value={draft.notes} onChange={setField("notes")}>
            <Label>Notas</Label>
            <TextArea data-testid="partner-edit-notes-input" />
          </TextField>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-medium text-muted">Método de pago</legend>
          <p className="text-sm" data-testid="partner-edit-bank-current">
            Actual: {paymentMethodSummary ?? "ninguno"}
          </p>
          <Select
            fullWidth
            value={bank.action}
            onChange={(value) => {
              if (value === "bancolombia") {
                setBank({ action: "bancolombia", nombre: "", numeroCuenta: "", tipoCuenta: "" });
              } else if (value === "nequi") {
                setBank({ action: "nequi", nombre: "", telefono: "" });
              } else if (value === "keep" || value === "remove") {
                setBank({ action: value });
              }
            }}
          >
            <Label>Cambio</Label>
            <Select.Trigger data-testid="partner-edit-bank-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="keep" textValue="Sin cambios">
                  Sin cambios
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="bancolombia" textValue="Reemplazar por Bancolombia">
                  Reemplazar por Bancolombia
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="nequi" textValue="Reemplazar por Nequi">
                  Reemplazar por Nequi
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {paymentMethodSummary ? (
                  <ListBox.Item id="remove" textValue="Quitar el método de pago">
                    Quitar el método de pago
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ) : null}
              </ListBox>
            </Select.Popover>
          </Select>

          {bank.action === "bancolombia" || bank.action === "nequi" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="partner-edit-bank-nombre">Titular</Label>
              <Input
                id="partner-edit-bank-nombre"
                value={bank.nombre}
                onChange={(event) => setBank({ ...bank, nombre: event.target.value })}
              />
            </div>
          ) : null}

          {bank.action === "bancolombia" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="partner-edit-bancolombia-numero">Número de cuenta</Label>
                <Input
                  id="partner-edit-bancolombia-numero"
                  value={bank.numeroCuenta}
                  onChange={(event) => setBank({ ...bank, numeroCuenta: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="partner-edit-bancolombia-tipo">Tipo de cuenta</Label>
                <Input
                  id="partner-edit-bancolombia-tipo"
                  value={bank.tipoCuenta}
                  onChange={(event) => setBank({ ...bank, tipoCuenta: event.target.value })}
                />
              </div>
            </div>
          ) : null}

          {bank.action === "nequi" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="partner-edit-nequi-telefono">Teléfono Nequi</Label>
              <Input
                id="partner-edit-nequi-telefono"
                value={bank.telefono}
                onChange={(event) => setBank({ ...bank, telefono: event.target.value })}
              />
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" isDisabled={isSubmitting} data-testid="partner-identity-save-button">
            {isSubmitting ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button
            type="button"
            variant="outline"
            isDisabled={isSubmitting}
            onPress={() => setIsEditing(false)}
            data-testid="partner-identity-cancel-button"
          >
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  );
}
