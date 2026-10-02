"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { nowIsoInstant, REF_CODE_MAX_LENGTH } from "@hifago/domain";
import {
  Button,
  Checkbox,
  Input,
  Label,
  ListBox,
  Select,
  TextArea,
  TextField,
  toast,
} from "@hifago/ui";
import { mountAddressAutocomplete } from "@/components/address-autocomplete";

type BankMethod = "none" | "bancolombia" | "nequi";
type CommercialStatus = "prospecto" | "activo" | "inactivo" | "pausa";
// Miroir local du type Json généré par Supabase (packages/supabase/src/database.types.ts) — pas
// réexporté par client.ts/server.ts, redéfini ici plutôt que d'élargir le barrel pour un seul
// usage.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type CreatePartnerResult = {
  ok: boolean;
  partner_id?: string;
  invitation_id?: string;
  invitation_token?: string;
};

const COMMERCIAL_STATUS_LABELS: Record<CommercialStatus, string> = {
  prospecto: "Prospecto",
  activo: "Activo",
  inactivo: "Inactivo",
  pausa: "En pausa",
};

export function NewPartnerForm() {
  const router = useRouter();

  // Identidad
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [identificationType, setIdentificationType] = useState("");
  const [identificationNumber, setIdentificationNumber] = useState("");
  const [partnerCity, setPartnerCity] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Capacidades
  const [isReferrer, setIsReferrer] = useState(true);
  const [isOperator, setIsOperator] = useState(false);

  // Código de atribución
  const [code, setCode] = useState("");
  const [commissionEnabled, setCommissionEnabled] = useState(true);

  // Perfil comercial (unificado en esta misma pantalla — decisión Jérôme 2026-08-14, spec §5)
  const [address, setAddress] = useState("");
  const [barrio, setBarrio] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [commercialStatus, setCommercialStatus] = useState<CommercialStatus>("prospecto");
  const [notes, setNotes] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [bankNombre, setBankNombre] = useState("");
  const [bankMethod, setBankMethod] = useState<BankMethod>("none");
  const [bancolombiaNumeroCuenta, setBancolombiaNumeroCuenta] = useState("");
  const [bancolombiaTipoCuenta, setBancolombiaTipoCuenta] = useState("");
  const [nequiTelefono, setNequiTelefono] = useState("");

  // Invitación
  const [sendInvitation, setSendInvitation] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const addressSearchRef = useRef<HTMLDivElement | null>(null);

  // Recherche Google Places au fil de la frappe (demande explicite de Jérôme) — un vrai widget
  // Google (google.maps.places.PlaceAutocompleteElement, cf. address-autocomplete.ts) monté dans
  // ce conteneur ; choisir une suggestion remplit "Dirección" et lat/lon ci-dessous en un geste.
  // No-op silencieux si NEXT_PUBLIC_GOOGLE_MAPS_API_KEY est absent — "Dirección" reste éditable
  // à la main dans tous les cas, jamais un blocage de la création.
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

  function buildCrmProfile(): Json | undefined {
    const hasCommercialData =
      address.trim() ||
      barrio.trim() ||
      tagsInput.trim() ||
      notes.trim() ||
      lat.trim() ||
      lon.trim() ||
      bankNombre.trim() ||
      bankMethod !== "none";
    if (!hasCommercialData) return undefined;

    const profile: { [key: string]: Json } = {
      address: address.trim() || null,
      barrio: barrio.trim() || null,
      tags: tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      commercial_status: commercialStatus,
      notes: notes.trim() || null,
      lat: lat.trim() || null,
      lon: lon.trim() || null,
    };

    if (bankNombre.trim() || bankMethod !== "none") {
      const bank: { [key: string]: Json } = {
        nombre: bankNombre.trim(),
        received_at: nowIsoInstant(),
      };
      if (bankMethod === "bancolombia") {
        bank.bancolombia = {
          numero_cuenta: bancolombiaNumeroCuenta.trim(),
          tipo_cuenta: bancolombiaTipoCuenta.trim(),
        };
      } else if (bankMethod === "nequi") {
        bank.nequi = { telefono: nequiTelefono.trim() };
      }
      profile.bank = bank;
    }

    return profile;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!displayName.trim()) {
      toast.danger("El nombre es obligatorio.");
      return;
    }
    const roles: string[] = [];
    if (isReferrer) roles.push("referrer");
    if (isOperator) roles.push("operator");
    if (roles.length === 0) {
      toast.danger("Selecciona al menos una capacidad (referente y/o prestador).");
      return;
    }
    if (sendInvitation && !code.trim()) {
      toast.danger("Un código de atribución es obligatorio para enviar una invitación.");
      return;
    }
    // Même borne que la vitrine (REF_CODE_MAX_LENGTH, @hifago/domain), qui ignore un code plus
    // long : créé ici, il aurait perdu son attribution en silence. Refus explicite, jamais une
    // troncature (un `maxLength` couperait un code collé sans le dire).
    if (code.trim().length > REF_CODE_MAX_LENGTH) {
      toast.danger(`El código no puede tener más de ${REF_CODE_MAX_LENGTH} caracteres.`);
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_partner_direct", {
      p_display_name: displayName.trim(),
      p_roles: roles,
      p_legal_name: legalName.trim() || undefined,
      p_identification_type: identificationType.trim() || undefined,
      p_identification_number: identificationNumber.trim() || undefined,
      p_partner_city: partnerCity.trim() || undefined,
      p_email: email.trim() || undefined,
      p_phone: phone.trim() || undefined,
      p_code: code.trim() || undefined,
      p_commission_enabled: commissionEnabled,
      p_crm_profile: buildCrmProfile(),
      p_send_invitation: sendInvitation,
    });

    setIsSubmitting(false);

    const result = data as CreatePartnerResult | null;
    if (rpcError || !result?.ok || !result.partner_id) {
      toast.danger("No se pudo crear el partner.");
      return;
    }

    toast.success("Partner creado.");

    if (result.invitation_token) {
      setInvitationLink(`${window.location.origin}/partner/join?token=${result.invitation_token}`);
      return;
    }

    router.push(`/admin/partners/${result.partner_id}`);
    router.refresh();
  }

  async function handleCopy() {
    if (!invitationLink) return;
    await navigator.clipboard.writeText(invitationLink);
    setCopied(true);
  }

  if (invitationLink) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <p className="text-sm text-success">Partner creado correctamente.</p>
        <p className="text-sm text-muted">
          Este enlace solo se muestra una vez — cópialo ahora, no podrás recuperarlo después (solo
          su hash queda guardado).
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invitation-link">Enlace de invitación</Label>
          <Input id="invitation-link" data-testid="invitation-link" readOnly value={invitationLink} />
        </div>
        <Button type="button" onPress={handleCopy} data-testid="copy-link-button">
          {copied ? "Copiado" : "Copiar enlace"}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-2xl flex-col gap-8">
      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold">Identidad</legend>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display-name">Nombre</Label>
          <Input
            id="display-name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            data-testid="display-name-input"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="legal-name">Razón social — opcional</Label>
          <Input
            id="legal-name"
            value={legalName}
            onChange={(event) => setLegalName(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="identification-type">Tipo de identificación — opcional</Label>
            <Input
              id="identification-type"
              placeholder="NIT, cédula…"
              value={identificationType}
              onChange={(event) => setIdentificationType(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="identification-number">Número — opcional</Label>
            <Input
              id="identification-number"
              value={identificationNumber}
              onChange={(event) => setIdentificationNumber(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="partner-city">Ciudad — opcional</Label>
          <Input
            id="partner-city"
            value={partnerCity}
            onChange={(event) => setPartnerCity(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email — opcional</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Teléfono — opcional</Label>
            <Input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-semibold">Capacidades</legend>
        <Checkbox
          data-testid="role-referrer-checkbox"
          isSelected={isReferrer}
          onChange={setIsReferrer}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            Referente
          </Checkbox.Content>
        </Checkbox>
        <Checkbox
          data-testid="role-operator-checkbox"
          isSelected={isOperator}
          onChange={setIsOperator}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            Prestador (implica también referente)
          </Checkbox.Content>
        </Checkbox>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold">Código de atribución — opcional</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Código</Label>
          <Input id="code" value={code} onChange={(event) => setCode(event.target.value)} data-testid="code-input" />
        </div>
        <Checkbox
          data-testid="commission-enabled-checkbox"
          isSelected={commissionEnabled}
          onChange={setCommissionEnabled}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            Comisión activa para este código
          </Checkbox.Content>
        </Checkbox>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold">Perfil comercial — opcional</legend>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address-search">Buscar dirección (Google)</Label>
          {/* Web Component Google — pas de <Input> HeroUI ici, il gère son propre champ interne */}
          <div id="address-search" ref={addressSearchRef} data-testid="address-search" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address">Dirección</Label>
          <Input
            id="address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
            data-testid="address-input"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lat">Latitud — detectada o manual</Label>
            <Input id="lat" value={lat} onChange={(event) => setLat(event.target.value)} data-testid="lat-input" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lon">Longitud — detectada o manual</Label>
            <Input id="lon" value={lon} onChange={(event) => setLon(event.target.value)} data-testid="lon-input" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="barrio">Barrio</Label>
          <Input id="barrio" value={barrio} onChange={(event) => setBarrio(event.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tags">Tags — separados por coma</Label>
          <Input id="tags" value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} />
        </div>

        <Select
          fullWidth
          value={commercialStatus}
          onChange={(value) => value && setCommercialStatus(value as CommercialStatus)}
        >
          <Label>Estado comercial</Label>
          <Select.Trigger data-testid="commercial-status-select">
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

        <TextField fullWidth value={notes} onChange={setNotes}>
          <Label>Notas</Label>
          <TextArea data-testid="notes-input" />
        </TextField>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-nombre">Banco — titular</Label>
          <Input
            id="bank-nombre"
            value={bankNombre}
            onChange={(event) => setBankNombre(event.target.value)}
          />
          <p className="text-xs text-muted">
            Dato provisorio de contacto — no conectado aún a un pago real (pendiente de
            establishments.payout_method, spec §10).
          </p>
        </div>

        <Select
          fullWidth
          value={bankMethod}
          onChange={(value) => value && setBankMethod(value as BankMethod)}
        >
          <Label>Método de pago</Label>
          <Select.Trigger data-testid="bank-method-select">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="none" textValue="Ninguno">
                Ninguno
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="bancolombia" textValue="Bancolombia">
                Bancolombia
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="nequi" textValue="Nequi">
                Nequi
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>

        {bankMethod === "bancolombia" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bancolombia-numero">Número de cuenta</Label>
              <Input
                id="bancolombia-numero"
                value={bancolombiaNumeroCuenta}
                onChange={(event) => setBancolombiaNumeroCuenta(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bancolombia-tipo">Tipo de cuenta</Label>
              <Input
                id="bancolombia-tipo"
                value={bancolombiaTipoCuenta}
                onChange={(event) => setBancolombiaTipoCuenta(event.target.value)}
              />
            </div>
          </div>
        ) : null}

        {bankMethod === "nequi" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nequi-telefono">Teléfono Nequi</Label>
            <Input
              id="nequi-telefono"
              value={nequiTelefono}
              onChange={(event) => setNequiTelefono(event.target.value)}
            />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-semibold">Invitación</legend>
        <Checkbox
          data-testid="send-invitation-checkbox"
          isSelected={sendInvitation}
          onChange={setSendInvitation}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            Enviar invitación de conexión (requiere un código de atribución)
          </Checkbox.Content>
        </Checkbox>
      </fieldset>

      <Button type="submit" isDisabled={isSubmitting} data-testid="create-partner-button">
        {isSubmitting ? "Creando…" : "Crear partner"}
      </Button>
    </form>
  );
}
