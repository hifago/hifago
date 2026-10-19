import Link from "next/link";
import { buttonVariants } from "@hifago/ui";
import { CommissionStates, ReferrerActions, ReferrerSteps } from "./PartnerReferrerWelcome";

// Accueil du prestataire (texte validé par Jérôme, 2026-10-19) — une étape à la fois, choisie par
// providerWelcomeStep.ts. Le mot est « servicio », celui de la nav (« Mi establecimiento y
// servicios ») : « Actividad » est un TYPE de fiche parmi d'autres. Un établissement n'est pas
// forcément un lieu — seul son nom est obligatoire (NewEstablishmentProposalForm).
// Ce texte ne promet rien que l'app ne fasse : revue admin de l'établissement, services proposés
// pendant cette revue et revus séparément (20261019120000), photos d'un service seulement une fois
// approuvé (page /partner/products/new), tout prestataire est aussi référent (trigger
// enforce_operator_implies_referrer).

const SECTION = "flex max-w-3xl flex-col gap-5 rounded-lg border border-border bg-surface p-5";

// Établissement proposé, pas encore approuvé : dit tel quel, jamais « Aún no tienes ningún
// establecimiento » (l'accueil le répétait juste après la création).
export function EstablishmentInReviewNote() {
  return (
    <p data-testid="partner-establishment-in-review">
      Tu establecimiento <strong>está en revisión</strong>: un administrador de Hifago lo revisa antes de
      publicarlo. Te avisaremos de su decisión.
    </p>
  );
}

// Bloc 1 — première connexion. testId repris de l'ancien état vide (« partner-establishment-
// pending ») : même contrat e2e (admin-invitations.spec.ts, partner-propose-establishment-…).
export function ProviderEstablishmentStep() {
  return (
    <section className={SECTION} data-testid="partner-establishment-pending">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">¡Bienvenido a Hifago!</h2>
        <p>
          Eres <strong>prestador</strong>: ofreces tus servicios (alojamiento, tours, transporte,
          eventos…) a los viajeros de Hifago y recibes sus reservas aquí.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Paso 1: crea tu establecimiento</h3>
        <p>
          Tu establecimiento es la cara de tu negocio en Hifago: el nombre con el que los viajeros te
          conocen y que reúne todos tus servicios. Puede ser un lugar, como un hotel o una finca, o
          simplemente tu marca: un guía independiente, una empresa de transporte, una agencia sin
          oficina. Le das un nombre, una descripción y fotos. Si recibes a tus clientes en un sitio,
          también puedes indicar su dirección.
        </p>
        <p>
          Un administrador de Hifago lo revisa antes de publicarlo. No tienes que esperar: mientras
          tanto ya puedes proponer tus servicios.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/partner/establishment/new"
          className={buttonVariants({ size: "sm" })}
          data-testid="partner-establishment-pending-action"
        >
          Añadir mi establecimiento
        </Link>
      </div>
    </section>
  );
}

// Bloc 2 — premier service : sur l'accueil (avec le bouton) et en tête du formulaire de service
// (sans bouton, on y est déjà).
export function ProviderServiceStep({
  actionHref,
  establishmentPending = false,
}: {
  actionHref?: string;
  establishmentPending?: boolean;
}) {
  return (
    <section className={SECTION} data-testid="partner-provider-service-step">
      {establishmentPending ? <EstablishmentInReviewNote /> : null}
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Paso 2: propón tu primer servicio</h2>
        <p>
          Un servicio es lo que el cliente reserva y paga: una noche de alojamiento, un tour, un paseo
          en lancha, un traslado, un evento. Cada servicio tiene su ficha: precio, descripción y
          condiciones. Un mismo establecimiento puede tener varios.
        </p>
        <p>
          Cada servicio se revisa por separado de tu establecimiento. Las fotos se añaden una vez
          aprobado. Después defines sus fechas y horarios disponibles en{" "}
          <em>Mi establecimiento y servicios</em>, y las reservas aparecen en tu <em>Agenda</em> y en{" "}
          <em>Mis reservas</em>.
        </p>
      </div>

      {actionHref ? (
        <div className="flex flex-wrap gap-3">
          <Link
            href={actionHref}
            className={buttonVariants({ size: "sm" })}
            data-testid="partner-provider-service-step-action"
          >
            Añadir mi primer servicio
          </Link>
        </div>
      ) : null}
    </section>
  );
}

// Bloc 3 — le prestataire est aussi référent : mêmes étapes, mêmes états, mêmes boutons que
// l'accueil du référent seul (PartnerReferrerWelcome). S'efface dès le compte Mercado Pago saisi.
export function ProviderReferrerStep({ establishmentPending = false }: { establishmentPending?: boolean }) {
  return (
    <section className={SECTION} data-testid="partner-provider-referrer-step">
      {establishmentPending ? <EstablishmentInReviewNote /> : null}
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">También eres referente</h2>
        <p>
          Todo prestador es también <strong>referente</strong>: además de tus propios servicios, puedes
          recomendar los demás alojamientos y experiencias de Hifago a tus huéspedes y clientes. Cada
          reserva hecha con tu código te genera una comisión.
        </p>
        <ReferrerSteps />
      </div>

      <div className="flex flex-col gap-2">
        <p>
          En <em>Mis comisiones</em> sigues cada venta, con su estado:
        </p>
        <CommissionStates />
      </div>

      <ReferrerActions testIdPrefix="partner-provider-referrer-step" />
    </section>
  );
}
