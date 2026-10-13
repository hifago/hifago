-- Un établissement peut être un LIEU, pas un prestataire (décision Jérôme, 2026-10-13).
--
-- LE BESOIN. `products.establishment_id` est `not null` pour tous les types (feature 1, précédent
-- de la spec 14) : un événement du municipio (Fiestas de Zócalos y Flores, Media Maratón…) qui ne
-- dépend d'aucun socio est donc rattaché à un établissement du partenaire plateforme, nommé
-- « Guatapé ». Ce n'est ni un commerce ni un hébergement : c'est le village. Sans marqueur, il
-- recevait comme tout établissement actif une fiche publique `/establecimientos/guatape`, une
-- entrée au sitemap et un JSON-LD `LocalBusiness` — trois affirmations fausses.
--
-- CE QUE LE MARQUEUR CHANGE, ET SEULEMENT ÇA : un lieu n'a pas de fiche publique. Son NOM reste
-- lisible partout (carte du catalogue, fiche produit, panier, commande) — c'est tout l'intérêt —
-- donc `establishments_select_public` n'est PAS touchée : y exclure les lieux rendrait
-- l'établissement nul dans chaque jointure anonyme. La règle vit là où un lien vers la fiche est
-- fabriqué : la lecture de la fiche elle-même, le sitemap, la fiche produit (`apps/web`), et
-- `order_for_client_jsonb` ci-dessous pour les commandes.
--
-- Écriture RLS-directe admin comme le reste de la table (`establishments_write_admin`) : donnée
-- définitionnelle, aucun des critères RPC-only de CLAUDE.md §3.1 — la RPC étroite ci-dessous
-- n'existe que pour l'audit nominatif et la garde, comme `set_establishment_status`.

alter table public.establishments
  add column is_place boolean not null default false,
  -- Un lieu n'est jamais un endroit où l'on dort : `mode` renseigné veut dire « on y dort », et
  -- c'est lui qui fait dire `LodgingBusiness` au JSON-LD.
  add constraint establishments_place_has_no_stay_mode check (not is_place or mode is null);

-- ⚠️ INDISPENSABLE : `establishments` n'a aucun grant SELECT au niveau table (20260819110000).
-- Sans cette ligne, toute requête anonyme qui nomme la colonne échoue ENTIÈRE sur « permission
-- denied for column », avant la RLS (piège §11.1).
grant select (is_place) on public.establishments to anon, authenticated;

-- `security invoker`, comme `set_establishment_status` : le rempart est la policy
-- `establishments_write_admin` (un non-admin ne voit aucune ligne à modifier), et
-- `log_admin_action` refuse tout ce qui n'est pas admin.
create function public.set_establishment_is_place(
  p_establishment_id uuid,
  p_is_place boolean,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_before boolean;
begin
  select is_place into v_before from public.establishments where id = p_establishment_id;

  -- Un établissement qui porte un hébergement ne devient pas un lieu : la carte GROUPÉE du
  -- catalogue (`search_catalog`, `es_establecimiento`) mène à sa fiche, qui n'existerait plus.
  -- ⚠️ Garde à sens unique : rien n'empêche de créer ENSUITE un hébergement sur un lieu. Assumé —
  -- un lieu est posé par la plateforme, jamais proposé par un socio.
  if p_is_place and exists (
    select 1 from public.establishments e
     where e.id = p_establishment_id
       and (e.mode is not null
            or exists (select 1 from public.products p
                        where p.establishment_id = e.id and p.type = 'lodging'))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'has_lodging');
  end if;

  update public.establishments
     set is_place = p_is_place,
         updated_at = now()
   where id = p_establishment_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  perform public.log_admin_action(
    'establishment.set_is_place', 'establishments', p_establishment_id,
    jsonb_build_object('is_place', v_before),
    jsonb_build_object('is_place', p_is_place),
    p_note
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- Une fonction neuve est exécutable par PUBLIC par défaut (sens inverse d'une table) : refermé
-- explicitement, même si la RLS tiendrait seule.
revoke all on function public.set_establishment_is_place(uuid, boolean, text) from public, anon;
grant execute on function public.set_establishment_is_place(uuid, boolean, text) to authenticated, service_role;

-- `order_for_client_jsonb` : le slug d'un lieu n'est plus rendu. Les deux écrans de commande
-- (`reserva/[token]`, `cuenta/reservas`) font de `establishment_slug` un lien vers la fiche dès
-- qu'il est présent — pour un lieu, ce serait un lien mort sur CHAQUE commande d'un événement
-- réservable en ligne, pas le 404 rare d'un établissement dépublié. Le nom, lui, reste.
-- Définition vivante extraite par `pg_get_functiondef`, UNE occurrence remplacée (la ligne
-- `'establishment_slug'`), rien d'autre retouché.
CREATE OR REPLACE FUNCTION public.order_for_client_jsonb(p_order orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lignes as (
    select
      jsonb_build_object(
        'id', ol.id,
        'product_name', p.name,
        'product_type', p.type,
        'product_slug', p.slug,
        'establishment_name', e.name,
        'establishment_slug', case when e.is_place then null else e.slug end,
        'establishment_contact_phone', e.contact_phone,
        'date', ol.date,
        'end_date', ol.end_date,
        -- `duration_days` — NUL pour tout ce qui n'est pas `camp` (contrainte
        -- `products_duration_days_required_for_camp`, 20260814220000). L'écran reconstitue la
        -- date de fin d'un camp à partir de `date` + cette valeur, jamais l'inverse.
        'duration_days', p.duration_days,
        'slot_start_time', ol.slot_start_time,
        'qty', ol.qty,
        'price_cop', ol.price_cop,
        'total_cop', ol.total_cop,
        'acompte_cop', ol.acompte_cop,
        'status', ol.status
      ) as ligne,
      ol.created_at as ligne_created_at,
      ol.id as ligne_id,
      ol.total_cop as ligne_total_cop,
      ol.acompte_cop as ligne_acompte_cop,
      (ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))
        as vivante
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    left join public.establishments e on e.id = p.establishment_id
    where ol.order_id = (p_order).id
  )
  select jsonb_build_object(
    'id', (p_order).id,
    'reference', (p_order).reference,
    'payment_status', (p_order).payment_status,
    'created_at', (p_order).created_at,
    'holder_name', (p_order).holder_name,
    'holder_phone', (p_order).holder_phone,
    'holder_email', (p_order).holder_email,
    'total_cop', coalesce(sum(ligne_total_cop) filter (where vivante), 0),
    'acompte_cop', coalesce(sum(ligne_acompte_cop) filter (where vivante), 0),
    -- Spec 39 D3 (20260922100000) : le client a payé, rien n'est honoré — vrai tant qu'une entrée
    -- refund_required (payé après expiration/annulation, écart de montant ; nuit PMS sans booking,
    -- intent remplacé : migration 20261002185102) est ouverte. Un DOUBLE
    -- paiement n'y entre pas : sa réservation EST honorée, seul le doublon est remboursé.
    'payment_received_not_honored', exists (
      select 1 from public.payment_reconciliation_entries e
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id and e.kind = 'refund_required'
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch', 'pms_booking_missing', 'superseded_intent')
        and e.status in ('open', 'retrying')
    ),
    -- Le dernier remboursement lié à ces mêmes entrées : pending → « en cours », approved → « te
    -- reembolsamos », rejected → l'admin reprend la main (le client reste sur « te contactamos »).
    'refund_status', (
      select r.status from public.payment_refunds r
      join public.payment_reconciliation_entries e on e.id = r.entry_id
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch', 'pms_booking_missing', 'superseded_intent')
      -- Par PRIORITÉ, pas par date : approved (l'argent est rendu) prime sur pending, qui prime
      -- sur rejected — plusieurs entrées peuvent viser la même commande.
      order by case r.status when 'approved' then 0 when 'pending' then 1 else 2 end, r.created_at desc
      limit 1
    ),
    -- Ordre INCHANGÉ (20260911100000) : les assertions pgTAP indexent `lines,0`.
    'lines', coalesce(jsonb_agg(ligne order by ligne_created_at, ligne_id), '[]'::jsonb)
  )
  from lignes;
$function$;
