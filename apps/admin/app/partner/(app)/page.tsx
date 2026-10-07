import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import {
  addDaysIso,
  asLocalizedField,
  lastBookableDateIso,
  resolveLocalizedField,
  todayInBogota,
} from "@hifago/domain";
import { Card, Chip } from "@hifago/ui";
import { EmptyStateCta } from "@/components/EmptyStateCta";
import { positionOrderLines, type OrderLineForAgenda, type SlotDuration } from "@/lib/agenda/positionOrderLines";
import { selectActiveOperatorEstablishmentIds } from "@/lib/agenda/activeOperatorEstablishments";
import { MANUAL_ORDER_INELIGIBLE_TYPES } from "@/lib/products/manualOrderEligibility";
import type { ProductType } from "@/lib/products/useProductTypeFieldsState";
import { PartnerAgenda } from "./PartnerAgenda";
import type { ProductOption } from "./AddReservationDialog";
import { partnerHomeHeader } from "./partnerHomeHeader";

const ROLE_LABELS: Record<string, string> = {
  referrer: "Referente",
  operator: "Prestador",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  suspended: "Suspendido",
};

const STATUS_CHIP_COLOR: Record<string, "default" | "success" | "warning" | "danger"> = {
  active: "success",
  suspended: "danger",
};

type CapabilityRow = {
  id: string;
  role: string;
  status: string;
  establishment_id: string | null;
};

type ProductRow = {
  id: string;
  name: unknown;
  type: string;
  establishment_id: string;
  duration_days: number | null;
};

// Fenêtre de lecture initiale de l'agenda — pas de refetch au changement de vue/date côté client
// en V1 (gap documenté, spec 20 §10 : lazy loading par plage visible renvoyé à une itération
// future). ±183 jours couvre largement l'usage réel (aujourd'hui, cette semaine, ce mois).
// Lot fuseau (2026-08-28) : la fenêtre mélangeait arithmétique LOCALE (setDate) et formatage UTC
// (toISOString) — deux fuseaux dans la même fonction de six lignes. Elle part désormais du jour
// civil de Guatapé, et l'arithmétique est purement civile.
// L'AVANT part de l'horizon produit (six mois, 2026-08-28) et non plus d'un « 183 jours » écrit à
// la main : le socio doit voir exactement ce que le client peut réserver, ni un jour de plus ni un
// de moins. Le RECUL (30 jours) reste un choix d'affichage propre à cet écran — c'est l'historique
// récent, pas une fenêtre de vente, et il n'a rien à dériver de l'horizon.
function agendaWindow(): { from: string; to: string } {
  const today = todayInBogota();
  return { from: addDaysIso(today, -30), to: lastBookableDateIso(today) };
}

// Spec 20 — remplace la page de statut d'onboarding pure par l'agenda de réservations (vue
// principale du socio, façon Google Calendar). La carte de statut (feature 29,
// docs/specs/05-invitations-onboarding-dashboard-partenaire.md §5.1) est conservée mais rendue
// conditionnelle : bandeau compact si toutes les capacités sont déjà actives, carte complète sinon
// — un partenaire suspendu ne doit jamais atterrir sur un agenda vide sans comprendre pourquoi.
export default async function PartnerHomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner");
  }

  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // affichait « Aún no tienes ningún rol asignado », ou un agenda vide.
  const { data: partnerId } = checkedRead(
    await supabase.rpc("partner_id_for_account", { uid: user.id }),
    "partner_id_for_account",
  );

  const { data: capabilities } = checkedRead(
    partnerId
      ? await supabase
          .from("partner_capabilities")
          .select("id, role, status, establishment_id")
          .eq("partner_id", partnerId)
          .order("role")
      : { data: null, error: null },
    "partner_capabilities",
  );

  const rows = (capabilities ?? []) as CapabilityRow[];

  // Lignes NON filtrées ci-dessus nécessaires pour la carte de statut (tous rôles/statuts) — mais
  // establishmentIds dérive de la même règle que reservations/page.tsx (role "operator", status
  // "active"), extraite dans lib/agenda/activeOperatorEstablishments plutôt que refiltrée ici en
  // JS avec un second littéral.
  const establishmentIds = selectActiveOperatorEstablishmentIds(rows);

  // Bloc d'en-tête : partnerHomeHeader.ts (« aucun établissement » testé AVANT « tout actif »).
  //
  // Simplification demandée par Jérôme (refonte vue prestataire, 2026-08-19) : quand rien n'est
  // encore configuré côté PRESTATAIRE (une capacité operator fraîchement créée, sans établissement
  // ni statut à signaler), un seul message "créer un établissement" remplace la carte détaillée
  // "Tus roles". Scopé précisément à la capacité operator (pas juste "aucun établissement actif" —
  // un pur référent n'a par construction jamais d'établissement et ne doit jamais se voir proposer
  // d'en créer un, cf. partner-join.spec.ts). Seul suspended exclut ce cas (signal explicite d'une
  // action admin, à afficher) — 'active' EST le statut par défaut d'une capacité operator
  // fraîchement créée depuis le 2026-08-20 (invitation, proposition approuvée ou octroi admin
  // direct sont tous les trois déjà un geste admin, cf.
  // 20260820010000_partner_capabilities_active_by_default.sql), aucune raison de le masquer
  // derrière la carte détaillée.
  const header = partnerHomeHeader(rows);

  let events: ReturnType<typeof positionOrderLines> = [];
  let productOptions: ProductOption[] = [];

  if (establishmentIds.length > 0) {
    const { from, to } = agendaWindow();

    // Spec 20 §10 point 9 : "superseded/expired masqués" — étendu à cancelled_by_client/
    // cancelled_by_provider (une réservation annulée n'a plus sa place sur l'agenda, contrairement
    // à la liste "Mis reservas" qui garde tout avec un filtre statut explicite). no_show reste
    // visible (le créneau a réellement eu lieu) — statuts bakés dans la RPC, jamais un paramètre.
    const [productsResult, linesResult] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, type, establishment_id, duration_days")
        .in("establishment_id", establishmentIds)
        .eq("sellable", true)
        .returns<ProductRow[]>(),
      supabase.rpc("partner_agenda_order_lines", { p_date_from: from, p_date_to: to }),
    ]);
    const { data: products } = checkedRead(productsResult, "products");
    const { data: lines } = checkedRead(linesResult, "partner_agenda_order_lines");

    const productRows = products ?? [];
    const lineRows = lines ?? [];

    // Ni l'une ni l'autre requête ne dépend du résultat de l'autre (seulement de slotProductIds/
    // linesWithSlot, déjà disponibles) — parallélisées via Promise.all plutôt qu'awaited en série.
    const slotProductIds = productRows.map((p) => p.id);
    const linesWithSlot = lineRows.filter((l) => l.slot_start_time !== null);
    const slotAvailabilityProductIds = Array.from(
      new Set(linesWithSlot.map((l) => l.product_id).filter((id): id is string => Boolean(id)))
    );

    const [slotRulesResult, slotDurationResult] = await Promise.all([
      slotProductIds.length > 0
        ? supabase.from("product_slot_rules").select("product_id").in("product_id", slotProductIds)
        : Promise.resolve({ data: [] as { product_id: string }[], error: null }),
      slotAvailabilityProductIds.length > 0
        ? supabase
            .from("product_slot_availability")
            .select("product_id, slot_date, slot_start_time, slot_duration_minutes")
            .in("product_id", slotAvailabilityProductIds)
            .gte("slot_date", from)
            .lte("slot_date", to)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const { data: slotRules } = checkedRead(slotRulesResult, "product_slot_rules");
    const { data: slotDurationRows } = checkedRead(slotDurationResult, "product_slot_availability");
    const productIdsWithSlots = new Set((slotRules ?? []).map((r) => r.product_id));

    const orderLinesForAgenda: OrderLineForAgenda[] = lineRows.map((line) => ({
      id: line.id,
      productId: line.product_id ?? "",
      productName: resolveLocalizedField(asLocalizedField(line.product_name), "es") ?? "—",
      productType: line.product_type ?? "",
      productDurationDays: line.product_duration_days ?? null,
      holderName: line.holder_name,
      qty: line.qty,
      status: line.status,
      date: line.date,
      endDate: line.end_date,
      slotStartTime: line.slot_start_time,
    }));

    const slotDurations: SlotDuration[] = (slotDurationRows ?? []).map((row) => ({
      productId: row.product_id,
      slotDate: row.slot_date,
      slotStartTime: row.slot_start_time,
      slotDurationMinutes: row.slot_duration_minutes,
    }));

    events = positionOrderLines(orderLinesForAgenda, slotDurations);

    productOptions = productRows
      .filter((p) => !MANUAL_ORDER_INELIGIBLE_TYPES.includes(p.type as ProductType))
      .map((p) => ({
        id: p.id,
        name: resolveLocalizedField(asLocalizedField(p.name), "es") ?? "—",
        hasSlots: productIdsWithSlots.has(p.id),
      }));
  }

  return (
    <div className="flex flex-col gap-6">
      {header === "first-establishment" ? (
        // Remplace l'ancienne double carte ("Tus roles" détaillée par rôle + bloc "agenda vide/
        // Crear producto" en dessous, redondant — "créer un produit" n'a jamais été la bonne
        // action avant d'avoir un établissement) par un seul message actionnable. testId conservé
        // identique à l'ancien sous-message ("partner-establishment-pending") : même contrat e2e
        // (admin-invitations.spec.ts), la fiche établissement n'a pas encore d'id à ce stade.
        <EmptyStateCta
          title="Aún no tienes ningún establecimiento"
          description="Añade tu establecimiento para empezar a publicar actividades y recibir reservas."
          actionHref="/partner/establishment/new"
          actionLabel="Añadir establecimiento"
          testId="partner-establishment-pending"
        />
      ) : header === "active-banner" ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-2">
          <span className="text-sm font-medium" data-testid="partner-status-compact">
            Prestador activo
          </span>
          <Link href="/partner/establishment" className="text-sm hover:underline">
            Mi establecimiento
          </Link>
        </div>
      ) : (
        <Card data-testid="partner-status-card">
          <Card.Header>
            <Card.Title>Tus roles</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {rows.length === 0 ? (
              <p className="text-sm text-muted">Aún no tienes ningún rol asignado.</p>
            ) : (
              rows.map((capability) => (
                <div
                  key={capability.id}
                  data-testid={`partner-role-${capability.role}`}
                  className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {ROLE_LABELS[capability.role] ?? capability.role}
                    </span>
                    <Chip variant="soft" color={STATUS_CHIP_COLOR[capability.status] ?? "default"}>
                      {STATUS_LABELS[capability.status] ?? capability.status}
                    </Chip>
                  </div>
                  {capability.role === "operator" && capability.establishment_id === null ? (
                    <p className="text-sm text-muted" data-testid="partner-establishment-pending">
                      Aún no tienes un establecimiento vinculado.{" "}
                      <Link href="/partner/establishment/new" className="underline">
                        Proponer un establecimiento
                      </Link>
                      .
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </Card.Content>
        </Card>
      )}

      {establishmentIds.length > 0 ? (
        <>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <PartnerAgenda events={events} productOptions={productOptions} />
        </>
      ) : null}
    </div>
  );
}
