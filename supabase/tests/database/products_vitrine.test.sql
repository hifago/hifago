-- Spec 30 (Tranche 2) — la contrainte `products_price_cop_required_unless_vitrine`, posée par
-- 20260908200000_products_vitrine_sin_precio.sql.
--
-- Ces assertions exercent la CHECK constraint au niveau schéma, en tant que postgres (superuser,
-- contourne RLS) — même dispositif que products_evento.test.sql, et pour la même raison : en
-- `anon`, une policy refuserait l'écriture AVANT que la contrainte n'ait son mot à dire, et le
-- test prouverait la policy, pas la contrainte (leçon du slug réservé, spec 29 §10ter).
begin;
select plan(7);

insert into partners (id, display_name) values
  ('88920000-0000-4000-8000-000000000001', 'Vitrine Test Partner');
insert into establishments (id, partner_id, name) values
  ('88920000-0000-4000-8000-000000000011', '88920000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Vitrine Test'));

-- Cas 1 — LE CAS QUE CETTE MIGRATION OUVRE : une activité en vitrine, sans prix chiffré.
-- Avant elle, cet insert était refusé : seuls les eventos étaient exemptés, donc une offre dont le
-- prix se négocie devait en inventer un.
select lives_ok(
  $$ insert into products (
       partner_id, establishment_id, type, name, sellable, slug,
       external_booking_url, price_label, price_cop
     ) values (
       '88920000-0000-4000-8000-000000000001', '88920000-0000-4000-8000-000000000011',
       'activity', jsonb_build_object('es', 'Tour privado a convenir'), true, 'tour-privado-vitrina',
       'https://wa.me/573001234567', 'Consultar', null
     ) $$,
  'une activité EN VITRINE (external_booking_url posé) s''insère sans price_cop'
);

-- Cas 2 — le garde-fou tient toujours pour tout le reste : ni evento, ni vitrine, ni prix.
select throws_ok(
  $$ insert into products (
       partner_id, establishment_id, type, name, sellable, slug, price_cop
     ) values (
       '88920000-0000-4000-8000-000000000001', '88920000-0000-4000-8000-000000000011',
       'activity', jsonb_build_object('es', 'Actividad Sin Precio'), true, 'actividad-sin-precio',
       null
     ) $$,
  '23514'::char(5),
  null,
  'une activité SANS url externe et SANS prix reste refusée — la contrainte n''est pas devenue permissive'
);

-- Cas 3 — l'exemption historique de l'evento n'a pas été perdue au passage. C'est le risque exact
-- d'un `drop constraint` suivi d'un `add` : réécrire la règle en en oubliant une branche.
select lives_ok(
  $$ insert into products (
       partner_id, establishment_id, type, name, sellable, slug, price_cop
     ) values (
       '88920000-0000-4000-8000-000000000001', '88920000-0000-4000-8000-000000000011',
       'evento', jsonb_build_object('es', 'Evento Sin Precio'), true, 'evento-sin-precio-vitrina',
       null
     ) $$,
  'un evento sans prix reste accepté — l''exemption d''origine survit au remplacement'
);

-- Cas 4 — l'ANCIENNE contrainte n'existe plus. Sans cette assertion, un `drop` oublié laisserait
-- les deux en place : la nouvelle serait satisfaite, l'ancienne refuserait quand même la vitrine,
-- et le message d'erreur pointerait une contrainte que plus aucun document ne mentionne.
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_price_cop_required_unless_evento'),
  0,
  'l''ancienne contrainte a bien été retirée, pas seulement doublée'
);

-- Cas 5-7 — `products_external_booking_url_scheme` (20261001144546) : le lien est rendu tel quel
-- dans la vitrine, seuls http et https sont admis. `throws_like` sur le NOM de la contrainte : un
-- 23514 seul pourrait venir d'une autre contrainte de products et prouverait autre chose.
select throws_like(
  $$ insert into products (
       partner_id, establishment_id, type, name, sellable, slug,
       external_booking_url, price_label, price_cop
     ) values (
       '88920000-0000-4000-8000-000000000001', '88920000-0000-4000-8000-000000000011',
       'activity', jsonb_build_object('es', 'Vitrina Esquema Ftp'), true, 'vitrina-esquema-ftp',
       'ftp://reservas.example.com', 'Consultar', null
     ) $$,
  '%products_external_booking_url_scheme%',
  'un lien externe dont le schéma n''est ni http ni https est refusé'
);
select throws_like(
  $$ insert into products (
       partner_id, establishment_id, type, name, sellable, slug,
       external_booking_url, price_label, price_cop
     ) values (
       '88920000-0000-4000-8000-000000000001', '88920000-0000-4000-8000-000000000011',
       'activity', jsonb_build_object('es', 'Vitrina Sin Esquema'), true, 'vitrina-sin-esquema',
       'wa.me/573001234567', 'Consultar', null
     ) $$,
  '%products_external_booking_url_scheme%',
  'un lien externe sans schéma est refusé'
);
select lives_ok(
  $$ insert into products (
       partner_id, establishment_id, type, name, sellable, slug,
       external_booking_url, price_label, price_cop
     ) values (
       '88920000-0000-4000-8000-000000000001', '88920000-0000-4000-8000-000000000011',
       'activity', jsonb_build_object('es', 'Vitrina Esquema Mayusculas'), true, 'vitrina-esquema-mayusculas',
       'HTTPS://reservas.example.com', 'Consultar', null
     ) $$,
  'le schéma est reconnu quelle que soit sa casse'
);

select * from finish();
rollback;
