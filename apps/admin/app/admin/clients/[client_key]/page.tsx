import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, formatDateInBogota, resolveLocalizedField } from "@hifago/domain";
import { ContactClientButton } from "@/components/ContactClientButton";
import { ClientOrderCard, type ClientOrderLineRow } from "./ClientOrderCard";

type PaymentQueryRow = {
  id: string;
  order_id: string;
  status: string;
  amount_cop: number;
  payer_email: string | null;
  created_at: string;
};

// Revue admin clientes (Jérôme, 2026-08-19) — objectif central de la refonte : en un clic depuis
// la liste, tout voir sur UNE page (infos de la personne, infos de paiement, activités
// rattachées) — jamais construite avant ce lot, ni en V1 (le clic sur un client V1 ouvre juste un
// fil WhatsApp, aucune fiche détail n'existe) ni en V2. client_key n'est pas une colonne stockée
// (coalesce account_id/email/phone/order_id, cf. client_key_for_order) — decodeURIComponent
// symétrique de l'encodage posé côté page liste (clients/page.tsx).
//
// Rendu délégué à ClientOrderCard ("use client") : cette page reste un pur Server Component qui
// fetch et résout les champs jsonb localisés, sans jamais construire elle-même de <SimpleTable>/
// <StatusChip> (cf. commentaire de ClientOrderCard — même piège que Recharts, hifago/CLAUDE.md
// §11.6, reproduit ici avec SimpleTable).
export default async function AdminClientDetailPage({
  params,
}: PageProps<"/admin/clients/[client_key]">) {
  const { client_key } = await params;
  // Un `%` mal formé dans l'URL fait lever decodeURIComponent : une adresse inconnue (404), jamais
  // l'écran d'erreur pour une faute de saisie.
  let decodedKey: string;
  try {
    decodedKey = decodeURIComponent(client_key);
  } catch {
    notFound();
  }

  const supabase = await createClient();

  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : la panne de
  // list_client_orders répondait « introuvable », celles des lignes et des paiements une fiche vide.
  // Seul « aucune commande » reste un 404.
  const { data: orders } = checkedRead(
    await supabase.rpc("list_client_orders", { p_client_key: decodedKey }),
    "list_client_orders",
  );
  if (!orders || orders.length === 0) {
    notFound();
  }

  const orderIds = orders.map((order) => order.order_id);

  // Identité affichée = la commande la plus récente (list_client_orders trie déjà created_at
  // desc, tiebreak order_id asc) — même repli "dernier connu" que list_clients pour
  // display_name/email/phone.
  const identity = orders[0];

  const [linesResult, paymentsResult] = await Promise.all([
    supabase.rpc("admin_client_order_lines", { p_order_ids: orderIds }),
    supabase
      .from("payments")
      .select("id, order_id, status, amount_cop, payer_email, created_at")
      .in("order_id", orderIds)
      .order("created_at", { ascending: false })
      .returns<PaymentQueryRow[]>(),
  ]);
  const { data: lines } = checkedRead(linesResult, "admin_client_order_lines");
  const { data: payments } = checkedRead(paymentsResult, "payments");

  const linesByOrder = new Map<string, ClientOrderLineRow[]>();
  for (const line of lines ?? []) {
    const existing = linesByOrder.get(line.order_id) ?? [];
    existing.push({
      id: line.id,
      establishmentName: resolveLocalizedField(asLocalizedField(line.establishment_name), "es") ?? "—",
      productName: resolveLocalizedField(asLocalizedField(line.product_name), "es") ?? "—",
      date: line.date,
      endDate: line.end_date,
      qty: line.qty,
      status: line.status,
      totalCop: line.total_cop,
    });
    linesByOrder.set(line.order_id, existing);
  }

  // Le dernier paiement par commande (payments déjà trié created_at desc) — s'affiche comme "le"
  // paiement de cette commande, cohérent avec l'objectif "infos de paiement" demandé, pas un
  // historique complet des tentatives.
  const latestPaymentByOrder = new Map<string, PaymentQueryRow>();
  for (const payment of payments ?? []) {
    if (!latestPaymentByOrder.has(payment.order_id)) {
      latestPaymentByOrder.set(payment.order_id, payment);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/admin/clients" className="text-sm text-muted hover:underline">
          ← Clientes
        </Link>
        <h1 className="text-2xl font-semibold">{identity.holder_name}</h1>
        <p className="text-sm text-muted" data-testid="client-detail-meta">
          {identity.holder_email ?? "—"} · {identity.holder_phone ?? "—"} · {orders.length}{" "}
          {orders.length === 1 ? "pedido" : "pedidos"}
        </p>
        {/* Revue admin clientes (Jérôme, 2026-08-20) — présent en V1 (le clic sur un client y
            ouvrait directement un fil WhatsApp), absent jusqu'ici de cette fiche V2. Composant déjà
            existant, réutilisé tel quel (jamais dupliqué) : même bouton que côté socio
            (ReservationActions.tsx), même normalisation de téléphone/filtre email sentinelle,
            cf. lib/whatsapp.ts. */}
        <ContactClientButton
          holderName={identity.holder_name}
          holderPhone={identity.holder_phone}
          holderEmail={identity.holder_email}
        />
      </div>

      <div className="flex flex-col gap-6">
        {orders.map((order) => {
          const payment = latestPaymentByOrder.get(order.order_id);
          return (
            <ClientOrderCard
              key={order.order_id}
              orderId={order.order_id}
              createdAtLabel={formatDateInBogota(order.created_at, "es")}
              referrerDisplayName={order.referrer_display_name}
              paymentStatus={order.payment_status}
              payment={
                payment
                  ? { status: payment.status, amountCop: payment.amount_cop, payerEmail: payment.payer_email }
                  : null
              }
              lines={linesByOrder.get(order.order_id) ?? []}
            />
          );
        })}
      </div>
    </div>
  );
}
