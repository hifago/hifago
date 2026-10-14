// Identité, contact et profil commercial saisis à la création (« Nuevo socio », create_partner_direct),
// en lecture seule : jusqu'ici la fiche ne relisait que le nom (recette de prod du 2026-10-13). La
// modification attend une RPC d'écriture auditée. Le moyen de paiement arrive déjà résumé (suffixe
// seul, calculé côté serveur par la page).

export type PartnerIdentity = {
  legalName: string | null;
  identification: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  commercialStatus: string | null;
  barrio: string | null;
  tags: string[];
  notes: string | null;
  paymentMethod: string | null;
};

function Item({ label, children, testId }: { label: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words" data-testid={testId}>
        {children ?? "—"}
      </dd>
    </div>
  );
}

export function PartnerIdentitySection({ identity }: { identity: PartnerIdentity }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Identidad y contacto</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        <Item label="Email" testId="partner-email">
          {identity.email ? <a href={`mailto:${identity.email}`} className="underline">{identity.email}</a> : null}
        </Item>
        <Item label="Teléfono" testId="partner-phone">
          {identity.phone ? <a href={`tel:${identity.phone}`} className="underline">{identity.phone}</a> : null}
        </Item>
        <Item label="Razón social" testId="partner-legal-name">{identity.legalName}</Item>
        <Item label="Identificación" testId="partner-identification">{identity.identification}</Item>
        <Item label="Ciudad" testId="partner-city">{identity.city}</Item>
        <Item label="Barrio" testId="partner-barrio">{identity.barrio}</Item>
        <Item label="Estado comercial" testId="partner-commercial-status">{identity.commercialStatus}</Item>
        <Item label="Método de pago" testId="partner-payment-method">{identity.paymentMethod}</Item>
        <Item label="Etiquetas" testId="partner-tags">
          {identity.tags.length > 0 ? identity.tags.join(", ") : null}
        </Item>
        <Item label="Notas" testId="partner-notes">
          {identity.notes ? <span className="whitespace-pre-line">{identity.notes}</span> : null}
        </Item>
      </dl>
    </section>
  );
}
