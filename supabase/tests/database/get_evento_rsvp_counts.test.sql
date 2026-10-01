-- get_evento_rsvp_counts (20260915120000, portée resserrée par 20261001144546) : le nombre
-- d'inscrits par date d'un evento en mode rsvp — et RIEN pour tout autre produit. Son seul
-- appelant (apps/web/lib/catalog/producto.ts) ne l'interroge que pour un evento rsvp ; la fonction
-- porte désormais ce contrat elle-même au lieu de sommer les lignes de n'importe quel produit.
begin;
select plan(5);

insert into partners (id, display_name) values
  ('88a40000-0000-4000-8000-000000000001', 'Rsvp Counts Partner');
insert into establishments (id, partner_id, name) values
  ('88a40000-0000-4000-8000-000000000011', '88a40000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Rsvp Counts'));

-- 021 : evento rsvp ; 022 : evento à capacité illimitée ; 023 : activité ordinaire.
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
  online_bookable, evento_capacity_mode, evento_payment_mode, occurrence_type, occurrence_date,
  evento_occupies_resource, default_capacity
)
values
  ('88a40000-0000-4000-8000-000000000021', '88a40000-0000-4000-8000-000000000001',
   '88a40000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento Rsvp Counts'),
   30000, true, 'rsvp-counts-evento-rsvp', true, 'rsvp', 'online', 'once', '2029-12-05', false, 200),
  ('88a40000-0000-4000-8000-000000000022', '88a40000-0000-4000-8000-000000000001',
   '88a40000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento Ilimitado Counts'),
   30000, true, 'rsvp-counts-evento-unlimited', true, 'unlimited', 'online', 'once', '2029-12-05', false, null);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88a40000-0000-4000-8000-000000000023', '88a40000-0000-4000-8000-000000000001',
   '88a40000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Counts'),
   30000, true, 'rsvp-counts-activity');

insert into auth.users (id, email) values
  ('88a40000-0000-4000-8000-000000000031', 'rsvp-counts-buyer@test.local');
insert into orders (id, account_id, holder_name, holder_email) values
  ('88a40000-0000-4000-8000-000000000041', '88a40000-0000-4000-8000-000000000031',
   'Rsvp Counts Holder', 'rsvp-counts-holder@test.local');

-- Sur chacun des trois produits, le même 2029-12-05 : deux lignes vivantes (2 + 3) et une annulée.
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
)
select
  '88a40000-0000-4000-8000-000000000041', '88a40000-0000-4000-8000-000000000031', p.id,
  '2029-12-05', l.qty, l.status, 'Rsvp Counts Holder',
  30000, 30000 * l.qty, 'direct', 0, 0, 0, 0, 0, 0
from (values
  ('88a40000-0000-4000-8000-000000000021'::uuid),
  ('88a40000-0000-4000-8000-000000000022'::uuid),
  ('88a40000-0000-4000-8000-000000000023'::uuid)
) as p(id)
cross join (values (2, 'reserved'), (3, 'fulfilled'), (4, 'cancelled_by_client')) as l(qty, status);

select is(
  (select array_agg(row(occurrence_date, registered_qty)::text)
     from get_evento_rsvp_counts('88a40000-0000-4000-8000-000000000021', '2029-12-01', '2029-12-31')),
  array[row('2029-12-05'::date, 5)::text],
  'evento rsvp : 5 inscrits le 2029-12-05 (2 + 3), la ligne annulée ne compte pas'
);
select is(
  (select count(*)::int
     from get_evento_rsvp_counts('88a40000-0000-4000-8000-000000000022', '2029-12-01', '2029-12-31')),
  0,
  'evento à capacité illimitée : aucun compte rendu, ce n''est pas un evento rsvp'
);
select is(
  (select count(*)::int
     from get_evento_rsvp_counts('88a40000-0000-4000-8000-000000000023', '2029-12-01', '2029-12-31')),
  0,
  'activité ordinaire : aucun compte rendu, quelles que soient ses lignes de commande'
);
select is(
  (select count(*)::int
     from get_evento_rsvp_counts('88a40000-0000-4000-8000-000000000021', '2029-12-06', '2029-12-31')),
  0,
  'la plage de dates borne toujours le compte'
);
-- Publique par conception (security_definer_exposure.test.sql) : la vitrine l'appelle sans session.
select ok(
  has_function_privilege('anon', 'public.get_evento_rsvp_counts(uuid, date, date)', 'EXECUTE'),
  'toujours exécutable par anon : la fiche d''un evento rsvp l''appelle sans session'
);

select * from finish();
rollback;
