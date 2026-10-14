-- Un établissement peut être un LIEU (20261013145953_establishment_is_place.sql) : le village de
-- Guatapé porte les événements du municipio, sans être un prestataire.
--
-- Ce fichier tient quatre choses distinctes :
--   • la CONTRAINTE (un lieu n'a jamais de `mode`), exercée en `postgres` — en `anon`, une policy
--     refuserait l'écriture avant que la contrainte n'ait son mot à dire ;
--   • les DROITS réels d'un visiteur, en `anon` : il LIT le marqueur, il n'écrit rien ;
--   • la RPC `set_establishment_is_place`, dans les conditions réelles (admin authentifié, puis
--     un compte sans capacité) ;
--   • `order_for_client_jsonb` : le slug d'un lieu n'est plus rendu, son nom si.
begin;
select plan(14);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('8a130000-0000-4000-8000-000000000001', 'Lieu Test Partner');

insert into auth.users (id, email) values
  ('8a130000-0000-4000-8000-000000000031', 'lieu-admin@test.local'),
  ('8a130000-0000-4000-8000-000000000032', 'lieu-tiers@test.local'),
  ('8a130000-0000-4000-8000-000000000033', 'lieu-acheteur@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('8a130000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

-- Trois établissements : le futur lieu, un hébergement (jamais un lieu), un prestataire ordinaire.
insert into establishments (id, partner_id, name, status) values
  ('8a130000-0000-4000-8000-000000000011', '8a130000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Pueblo Lieu Test'), 'active'),
  ('8a130000-0000-4000-8000-000000000012', '8a130000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Hostal Lieu Test'), 'active'),
  ('8a130000-0000-4000-8000-000000000013', '8a130000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Prestador Lieu Test'), 'active');

-- Un produit vendable par établissement : sans lui, `establishments_select_public` cache
-- l'établissement entier et les lectures anonymes passeraient pour la mauvaise raison.
insert into products (id, partner_id, establishment_id, type, slug, name, price_cop, sellable) values
  ('8a130000-0000-4000-8000-000000000021', '8a130000-0000-4000-8000-000000000001',
   '8a130000-0000-4000-8000-000000000011', 'activity', 'lieu-test-actividad',
   jsonb_build_object('es', 'Fiesta del pueblo'), 50000, true),
  ('8a130000-0000-4000-8000-000000000022', '8a130000-0000-4000-8000-000000000001',
   '8a130000-0000-4000-8000-000000000012', 'lodging', 'lieu-test-habitacion',
   jsonb_build_object('es', 'Habitación'), 90000, true),
  ('8a130000-0000-4000-8000-000000000023', '8a130000-0000-4000-8000-000000000001',
   '8a130000-0000-4000-8000-000000000013', 'activity', 'lieu-test-kayak',
   jsonb_build_object('es', 'Kayak'), 60000, true);

-- Une commande avec une ligne sur le produit du futur lieu.
insert into orders (id, account_id, holder_name, holder_email)
values ('8a130000-0000-4000-8000-000000000041', '8a130000-0000-4000-8000-000000000033',
        'Holder Lieu', 'holder-lieu@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('8a130000-0000-4000-8000-000000000051', '8a130000-0000-4000-8000-000000000041',
   '8a130000-0000-4000-8000-000000000033', '8a130000-0000-4000-8000-000000000021',
   '2026-11-01', 1, 'reserved', 'Holder Lieu',
   50000, 50000, 'direct', 0.17, 0, 0.17, 8500, 0, 8500);

-- ── Avant tout marquage ───────────────────────────────────────────────────────────────────────
select is(
  (select is_place from public.establishments where id = '8a130000-0000-4000-8000-000000000011'),
  false,
  'un établissement n''est pas un lieu par défaut'
);

select is(
  (select public.order_for_client_jsonb(o) #>> '{lines,0,establishment_slug}'
     from public.orders o where o.id = '8a130000-0000-4000-8000-000000000041'),
  (select slug from public.establishments where id = '8a130000-0000-4000-8000-000000000011'),
  'un établissement ordinaire : la ligne de commande porte son slug (lien vers sa fiche)'
);

-- ── La RPC, refusée à qui n'est pas admin ─────────────────────────────────────────────────────
set local role authenticated;
select test_login('8a130000-0000-4000-8000-000000000032');
select is(
  public.set_establishment_is_place('8a130000-0000-4000-8000-000000000011', true) ->> 'reason',
  'establishment_not_found',
  'un compte sans capacité admin ne marque rien : la RLS ne lui montre aucune ligne à modifier'
);
reset role;

select is(
  (select is_place from public.establishments where id = '8a130000-0000-4000-8000-000000000011'),
  false,
  'et rien n''a été écrit'
);

-- ── La RPC, en admin ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
select test_login('8a130000-0000-4000-8000-000000000031');

-- ⚠️ Appel en instruction À PART, jamais joint à la lecture qui le vérifie (ordre d'évaluation
-- d'un cross join non garanti — constaté dans establishments_contacto.test.sql).
select is(
  public.set_establishment_is_place('8a130000-0000-4000-8000-000000000012', true) ->> 'reason',
  'has_lodging',
  'un établissement qui porte un hébergement ne devient PAS un lieu — sa carte groupée mène à sa fiche'
);

select is(
  (public.set_establishment_is_place('8a130000-0000-4000-8000-000000000011', true, 'pueblo') ->> 'ok')::boolean,
  true,
  'un admin marque un établissement comme lieu'
);
reset role;

select is(
  (select is_place from public.establishments where id = '8a130000-0000-4000-8000-000000000011'),
  true,
  'le marqueur est posé'
);

select is(
  (select is_place from public.establishments where id = '8a130000-0000-4000-8000-000000000012'),
  false,
  'l''hébergement refusé n''a pas bougé'
);

-- Comptage SCOPÉ par l'identifiant de la fixture, jamais absolu (base locale partagée).
select is(
  (select count(*)::int from public.audit_log
    where action = 'establishment.set_is_place'
      and entity_id = '8a130000-0000-4000-8000-000000000011'
      and after = jsonb_build_object('is_place', true)),
  1,
  'le marquage est journalisé nominativement, une seule fois'
);

-- ── La contrainte, en postgres ────────────────────────────────────────────────────────────────
select throws_ok(
  $$ update public.establishments set mode = 'rooms'
      where id = '8a130000-0000-4000-8000-000000000011' $$,
  '23514'::char(5),
  null,
  'un lieu ne reçoit jamais de `mode` : on n''y dort pas, et le JSON-LD en ferait un LodgingBusiness'
);

-- ── Les droits réels d'un visiteur anonyme ────────────────────────────────────────────────────
-- ⚠️ Le jeton de l'admin posé par `test_login` vit jusqu'à la fin de la transaction : sans cette
-- remise à zéro, le rôle `anon` garderait SON `auth.uid()`, la policy admin le laisserait écrire,
-- et le test prouverait l'inverse de ce qui se passe en vrai (constaté à l'écriture de ce fichier).
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

-- ⚠️ L'assertion qui attrape un `grant select (is_place)` oublié : sans lui, ce select lève
-- « permission denied for column » avant la RLS — et la fiche, le sitemap et la fiche produit de
-- la vitrine tomberaient tous les trois.
select is(
  (select is_place from public.establishments where id = '8a130000-0000-4000-8000-000000000011'),
  true,
  'anon LIT le marqueur — et le lieu reste visible : son nom s''affiche sur ses événements'
);

-- `anon` hérite d'un grant UPDATE au niveau TABLE : le seul rempart est la policy
-- `establishments_write_admin`. L'UPDATE ne lève pas, il ne voit simplement aucune ligne.
select lives_ok(
  $$ update public.establishments set is_place = false
      where id = '8a130000-0000-4000-8000-000000000011' $$,
  'la tentative d''écriture anonyme ne lève aucune erreur — elle est simplement sans effet'
);

reset role;

select is(
  (select is_place from public.establishments where id = '8a130000-0000-4000-8000-000000000011'),
  true,
  'anon n''a rien écrit'
);

-- ── La commande d'un produit rattaché à un lieu ───────────────────────────────────────────────
select ok(
  (select (public.order_for_client_jsonb(o) #> '{lines,0,establishment_slug}') = 'null'::jsonb
          and (public.order_for_client_jsonb(o) #>> '{lines,0,establishment_name,es}') = 'Pueblo Lieu Test'
     from public.orders o where o.id = '8a130000-0000-4000-8000-000000000041'),
  'un lieu : la ligne de commande garde le NOM mais plus le slug — aucun lien vers une fiche qui n''existe pas'
);

select * from finish();
rollback;
