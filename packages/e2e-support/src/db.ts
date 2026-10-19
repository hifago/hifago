import { randomUUID } from "node:crypto";
import pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

const { Client } = pg;

// Port Postgres direct (54322) de la même stack Supabase Docker locale que SUPABASE_URL
// (auth.ts, port 54321 — passerelle API, pas la même chose) — jamais un projet cloud partagé
// (hifago/CLAUDE.md §6.4). Exporté pour tests/concurrency/*.concurrency.mjs, qui ont besoin de la
// même connexion directe hors du wrapper withDb (barrière de synchronisation multi-clients).
export const LOCAL_DB_CONNECTION_STRING = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CONNECTION_STRING = LOCAL_DB_CONNECTION_STRING;

export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Spec 19 §0 Tranche 1 : payments.order_id référence orders (FK payments_order_id_fkey). Une
// commande devenue orpheline (plus aucune order_line) peut porter un paiement RÉEL même en e2e —
// create_payment_intent n'est jamais mocké (seul l'appel SDK Mercado Pago externe l'est, cf.
// mockMercadoPagoCheckout) — donc à purger AVANT le delete orders ci-dessous, sinon la contrainte
// de clé étrangère bloque le nettoyage. Partagée entre resetAvailability (orderIds dérivés d'un
// (productId, date)) et deleteOrdersByHolderName (orderIds dérivés d'un holder_name) — même
// contrainte FK dans les deux cas, jamais une copie parallèle de cette logique.
async function purgePaymentsThenOrders(client: pg.Client, orderIds: string[]) {
  if (orderIds.length === 0) return;
  await client.query(
    "delete from payments where order_id = any($1) and order_id not in (select distinct order_id from order_lines)",
    [orderIds]
  );
  await client.query(
    "delete from orders where id = any($1) and id not in (select distinct order_id from order_lines)",
    [orderIds]
  );
}

/**
 * Remet une ressource (product_id, date) à un état de disponibilité connu et purge toute
 * commande existante qui la référence — extension réutilisable de resetLastSpot() (Checkpoint B,
 * apps/web/e2e/reserve-concurrency.spec.ts) pour les 3 specs Feature 6. Une commande qui porterait encore
 * une AUTRE ligne (vers une ressource différente, non gérée par cet appel) n'est jamais supprimée
 * en entier — seule la ligne concernée l'est, la commande elle-même seulement si elle devient
 * orpheline (plus aucune ligne du tout).
 */
export async function resetAvailability(
  productId: string,
  date: string,
  { capacity, booked = 0 }: { capacity: number; booked?: number }
) {
  await withDb(async (client) => {
    const { rows } = await client.query(
      "select distinct order_id from order_lines where product_id = $1 and date = $2",
      [productId, date]
    );
    // Tables qui référencent order_lines(id) (ledger_entries depuis spec 19 Tranche 0,
    // pms_reconciliation_entries/availability_blocks plus anciennes) — à purger AVANT le delete
    // order_lines ci-dessous, sinon leurs FK respectives bloquent le nettoyage.
    await client.query(
      "delete from ledger_entries where order_line_id in (select id from order_lines where product_id = $1 and date = $2)",
      [productId, date]
    );
    await client.query(
      "delete from pms_reconciliation_entries where order_line_id in (select id from order_lines where product_id = $1 and date = $2)",
      [productId, date]
    );
    await client.query(
      "delete from availability_blocks where source_order_line_id in (select id from order_lines where product_id = $1 and date = $2)",
      [productId, date]
    );
    await client.query("delete from order_lines where product_id = $1 and date = $2", [
      productId,
      date,
    ]);
    const orderIds = rows.map((row) => row.order_id as string);
    await purgePaymentsThenOrders(client, orderIds);
    await client.query(
      "update product_availability set capacity = $3, booked = $4 where product_id = $1 and date = $2",
      [productId, date, capacity, booked]
    );
  });
}

/**
 * Vide `cart_items` pour une ressource (product_id, date), tous comptes confondus — jamais touché
 * par `resetAvailability` ci-dessus (qui ne connaît que `order_lines`/`product_availability`).
 * Nécessaire pour tout spec qui déclenche volontairement un `create_order` en échec : la RPC laisse
 * alors `cart_items` INTACT (spec 32 §0, « le client garde son panier pour retenter ») — un
 * comportement voulu côté produit, mais qui rend le compte seedé sale pour la prochaine exécution
 * du même test si rien ne le nettoie explicitement (trouvé en écrivant
 * cart-multi-establishment.spec.ts : la 2ᵉ exécution du même test échouait sur un bouton "Añadir al
 * carrito" désactivé, capacité déjà "consommée" par le propre panier laissé par l'exécution d'avant).
 */
export async function clearCartItems(productId: string, date: string) {
  await withDb(async (client) => {
    await client.query("delete from cart_items where product_id = $1 and date = $2", [
      productId,
      date,
    ]);
  });
}

/**
 * Purge les orders d'un titulaire donné (et les payments qui les référencent, cf.
 * purgePaymentsThenOrders ci-dessus) — pour un fixture e2e qui construit ses propres commandes en
 * dehors du scope (productId, date) couvert par resetAvailability (ex. reserve-hotel-room.spec.ts,
 * reserve-lodging-range.spec.ts) et doit encore nettoyer la commande elle-même après avoir supprimé
 * ses order_lines. Appeler APRÈS avoir supprimé les order_lines concernées, sinon ces orders ne
 * sont pas encore orphelins et ne sont pas purgés.
 */
export async function deleteOrdersByHolderName(holderName: string) {
  await withDb(async (client) => {
    const { rows } = await client.query("select id from orders where holder_name = $1", [
      holderName,
    ]);
    await purgePaymentsThenOrders(
      client,
      rows.map((row) => row.id as string)
    );
  });
}

/**
 * Spec 23 — purge notification_emails avant tout nettoyage qui supprimerait un compte référencé
 * par recipient_account_id (FK vers partner_accounts) ou une entité référencée par related_id
 * (pas une vraie FK — related_table/related_id suit le pattern audit_log, jamais de contrainte —
 * mais laisser traîner des lignes orphelines pollue quand même les assertions d'un test suivant).
 * Filtre au choix par email destinataire ou par (related_table, related_id) — au moins un requis.
 */
export async function purgeNotificationEmails(filter: {
  recipientEmailLike?: string;
  relatedTable?: string;
  relatedId?: string;
}) {
  await withDb(async (client) => {
    if (filter.recipientEmailLike) {
      await client.query("delete from notification_emails where recipient_email like $1", [
        filter.recipientEmailLike,
      ]);
    }
    if (filter.relatedTable && filter.relatedId) {
      await client.query(
        "delete from notification_emails where related_table = $1 and related_id = $2",
        [filter.relatedTable, filter.relatedId]
      );
    }
  });
}

// Simule directement en base un événement concurrent (une autre commande qui consomme des
// places) survenu entre l'ajout au panier (purement local, cf. lib/cart/CartContext.tsx) et la
// validation du panier — la seule vraie barrière anti-survente reste create_order, jamais un
// contrôle au moment de l'ajout.
export async function setBooked(productId: string, date: string, booked: number) {
  await withDb((client) =>
    client.query(
      "update product_availability set booked = $3 where product_id = $1 and date = $2",
      [productId, date, booked]
    )
  );
}

export async function getAvailability(productId: string, date: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      "select capacity, booked from product_availability where product_id = $1 and date = $2",
      [productId, date]
    );
    return rows[0] as { capacity: number; booked: number } | undefined;
  });
}

export async function getPrice(productId: string) {
  return withDb(async (client) => {
    const { rows } = await client.query("select price_cop from products where id = $1", [
      productId,
    ]);
    return Number(rows[0]?.price_cop);
  });
}

// Remet un code d'attribution seedé à un état actif connu avant chaque test qui en dépend —
// nécessaire car apps/admin/e2e/admin-partner-registry.spec.ts fait BASCULER volontairement l'état de
// SEED-REFACTIVE (jamais remis à zéro entre deux runs, cf. commentaire dédié dans ce spec) : sans
// ce reset, un spec qui a besoin que ce code soit actif deviendrait dépendant de l'ordre
// d'exécution des autres specs. Même raisonnement que resetAvailability ci-dessus.
export async function setPartnerCodeActive(code: string, active: boolean) {
  await withDb((client) =>
    client.query("update partner_codes set active = $2 where code = $1", [code, active])
  );
}

export async function getEstablishmentName(productId: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      `select e.name->>'es' as name
         from public.products p
         join public.establishments e on e.id = p.establishment_id
        where p.id = $1`,
      [productId]
    );
    return rows[0]?.name as string | undefined;
  });
}

export async function countOrderLines(productId: string, date: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      "select coalesce(sum(qty), 0)::int as qty, count(*)::int as lines from order_lines where product_id = $1 and date = $2",
      [productId, date]
    );
    return rows[0] as { qty: number; lines: number };
  });
}

export async function countOrdersByPhone(phone: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      "select count(*)::int as count from orders where holder_phone = $1",
      [phone]
    );
    return Number(rows[0].count);
  });
}

// Feature 8 (annuler sa réservation) : confirmation en base, en plus du rechargement de page côté
// UI — preuve que la transition de statut a bien été persistée par cancel_order, pas seulement
// reflétée dans l'état client.
export async function getOrderLineStatuses(orderId: string) {
  return withDb(async (client) => {
    const { rows } = await client.query("select status from order_lines where order_id = $1", [
      orderId,
    ]);
    return rows.map((row) => row.status as string);
  });
}

/**
 * Crée un établissement DÉDIÉ via create_establishment (RPC admin) puis active immédiatement sa
 * capacité operator — même chemin que suivrait un admin en approuvant une proposition (§7 de la
 * spec établissements), plutôt qu'un insert SQL brut. Centralise un bloc de fixture dupliqué dans
 * plusieurs specs de proposition partenaire (établissement, photo, produit) qui ont chacune besoin
 * d'un établissement dédié (jamais le fixture partagé, cf. commentaires de ces specs) avec une
 * capacité operator déjà active pour operador.propuestas. Retourne l'id de l'établissement créé.
 */
export async function createActiveOperatorEstablishment(
  adminClient: SupabaseClient,
  partnerId: string,
  name: string
): Promise<string> {
  const { data: establishmentId, error: createError } = await adminClient.rpc(
    "create_establishment",
    // WhatsApp exigé depuis 20261019170000 — un numéro fictif à la forme colombienne.
    { p_partner_id: partnerId, p_name: { es: name }, p_contact_phone: "+573000000000" }
  );
  if (createError || !establishmentId) {
    throw new Error(`e2e setup: create_establishment a échoué : ${createError?.message}`);
  }
  const { data: capability } = await adminClient
    .from("partner_capabilities")
    .select("id")
    .eq("establishment_id", establishmentId)
    .eq("role", "operator")
    .single();
  const { error: statusError } = await adminClient.rpc("set_capability_status", {
    p_capability_id: capability!.id,
    p_new_status: "active",
  });
  if (statusError) {
    throw new Error(`e2e setup: set_capability_status a échoué : ${statusError.message}`);
  }
  return establishmentId as string;
}

/**
 * Feature 31 — révision 2026-08-19 : crée un compte email/mot de passe directement en base
 * (même patron que supabase/seed.sql, `crypt(password, gen_salt('bf'))`), indépendant de
 * l'endpoint public GoTrue (`supabase.auth.signUp`) — nécessaire depuis que
 * supabase/config.toml a `enable_signup=false` (inscription libre bloquée), qui fait échouer tout
 * appel signUp() y compris depuis un test e2e. Remplace l'ancien helper local `signUp()` de
 * auth-connection-complete.spec.ts, qui pilotait le formulaire /signup désormais neutralisé.
 * `handle_new_auth_user` (trigger sur auth.users) provisionne automatiquement la ligne
 * partner_accounts correspondante, comme pour tout autre insert dans auth.users.
 */
export async function createTestUser(
  email: string,
  password: string,
  { confirmed = true }: { confirmed?: boolean } = {}
): Promise<string> {
  const id = randomUUID();
  await withDb((client) =>
    client.query(
      `insert into auth.users (
         instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         created_at, updated_at, raw_app_meta_data, raw_user_meta_data
       ) values (
         '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
         $2, crypt($3, gen_salt('bf')), case when $4 then now() else null end, now(), now(),
         '{"provider":"email","providers":["email"]}', '{}'
       )`,
      [id, email, password, confirmed]
    )
  );
  return id;
}

export async function getOrderLinesForPhone(phone: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      `select ol.order_id, ol.product_id, to_char(ol.date, 'YYYY-MM-DD') as date, ol.qty
         from public.order_lines ol
         join public.orders o on o.id = ol.order_id
        where o.holder_phone = $1`,
      [phone]
    );
    return rows as { order_id: string; product_id: string; date: string; qty: number }[];
  });
}
