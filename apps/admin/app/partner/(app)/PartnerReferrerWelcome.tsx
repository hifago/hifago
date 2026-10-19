import Link from "next/link";
import { buttonVariants } from "@hifago/ui";

// Accueil du référent seul (texte validé par Jérôme, 2026-10-19) : remplace le bandeau « Referente
// activo » tant qu'aucun compte Mercado Pago n'est enregistré — la seule action obligatoire. Une
// fois le compte saisi, le bandeau compact revient (page.tsx). Ce texte ne promet rien que l'app ne
// fasse : états = COMMISSION_STATE_LABELS, « Ganada » au passage de la ligne en `fulfilled`
// (set_order_line_status), giro manuel par un admin (PayoutAccountBlock).
//
// Les deux étapes, les états de commission et les deux boutons sont exportés : le prestataire, qui
// est aussi référent, lit les mêmes (bloc « También eres referente », PartnerProviderWelcome.tsx)
// — un seul texte, jamais deux qui divergent.
const WHATSAPP_HREF = "https://wa.me/573215764841";

export function ReferrerSteps() {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5">
      <li>
        <strong>Registra tu cuenta de Mercado Pago</strong> en <em>Mi cuenta</em>. Ahí te enviamos
        tus comisiones. Sin esta cuenta no podemos pagarte.
      </li>
      <li>
        <strong>Comparte tu enlace o tu código QR</strong> en <em>Mi enlace y QR</em>. Puedes
        enviarlo por WhatsApp, imprimirlo o ponerlo en tu recepción. Toda reserva hecha a través de
        él queda atribuida a ti.
      </li>
    </ol>
  );
}

export function CommissionStates() {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      <li>
        <strong>Estimada</strong>: la reserva existe, pero el servicio todavía no se ha prestado.
      </li>
      <li>
        <strong>Ganada, por pagar</strong>: el servicio se prestó y tu comisión es definitiva.
      </li>
      <li>
        <strong>Pagada</strong>: ya la transferimos a tu cuenta de Mercado Pago.
      </li>
    </ul>
  );
}

export function ReferrerActions({ testIdPrefix }: { testIdPrefix: string }) {
  // flex-wrap : les deux actions passent l'une sous l'autre sur mobile, rien n'est masqué.
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        href="/partner/account"
        className={buttonVariants({ size: "sm" })}
        data-testid={`${testIdPrefix}-payout`}
      >
        Registrar mi cuenta de pago
      </Link>
      <Link
        href="/partner/tools"
        className={buttonVariants({ variant: "outline", size: "sm" })}
        data-testid={`${testIdPrefix}-tools`}
      >
        Ver mi enlace y QR
      </Link>
    </div>
  );
}

export function PartnerReferrerWelcome() {
  return (
    <section
      className="flex max-w-3xl flex-col gap-5 rounded-lg border border-border bg-surface p-5"
      data-testid="partner-referrer-welcome"
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">¡Bienvenido a Hifago!</h2>
        <p>
          Eres <strong>referente</strong>: recomiendas los alojamientos y experiencias de Hifago a tus
          huéspedes, clientes o contactos. Cada reserva hecha con tu código te genera una comisión.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Antes de empezar: 2 pasos</h3>
        <ReferrerSteps />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">
          Luego, en <em>Mis comisiones</em>, sigues cada venta
        </h3>
        <p>
          Para cada venta ves el cliente, el producto, el monto y tu comisión, con su estado:
        </p>
        <CommissionStates />
      </div>

      <p>
        <strong>Bueno saberlo:</strong> como referente no gestionas establecimientos ni reservas, eso lo
        hacen los prestadores. Si un día quieres ofrecer tu propio alojamiento o actividad, escríbenos
        al WhatsApp{" "}
        <a
          href={WHATSAPP_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline"
          data-testid="partner-referrer-welcome-whatsapp"
        >
          321 576 4841
        </a>
        .
      </p>

      <ReferrerActions testIdPrefix="partner-referrer-welcome" />
    </section>
  );
}
