-- Feature 17 (Socio : gérer directement son propre calendrier de cupos) — extension de
-- set_product_availability (correctif Tranche 2/3 + feature 5) : garde-fous identité/propriété/
-- capacité (mêmes que submit_product_proposal, feature 15) pour un appelant non-admin,
-- log_admin_action conditionnée à un appelant admin. Verrouillage FOR UPDATE et logique de
-- capacité inchangés — déjà couverts par le test de concurrence du correctif, rien à ajouter ici.
begin;
select plan(18);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 2 partenaires (own : point de vue principal, capacité operator active scopée à son
-- établissement ; other : tiers, cible "produit d'un autre partenaire") + 1 admin.
insert into partners (id, display_name) values
  ('77770000-0000-4000-8000-000000000001', 'Avail Socio Test Own'),
  ('77770000-0000-4000-8000-000000000002', 'Avail Socio Test Other');

insert into establishments (id, partner_id, name) values
  ('77770000-0000-4000-8000-000000000011', '77770000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Own')),
  ('77770000-0000-4000-8000-000000000012', '77770000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Other'));

insert into auth.users (id, email) values
  ('77770000-0000-4000-8000-000000000021', 'avail-socio-own@test.local'),
  ('77770000-0000-4000-8000-000000000022', 'avail-socio-other@test.local'),
  ('77770000-0000-4000-8000-000000000023', 'avail-socio-admin@test.local');

update partner_accounts set partner_id = '77770000-0000-4000-8000-000000000001'
 where id = '77770000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '77770000-0000-4000-8000-000000000002'
 where id = '77770000-0000-4000-8000-000000000022';

insert into partner_capabilities (partner_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('77770000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');

insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('77770000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '77770000-0000-4000-8000-000000000011'),
  ('77770000-0000-4000-8000-000000000002', 'operator', 'migration', 'active',
   '77770000-0000-4000-8000-000000000012');

insert into partner_capabilities (account_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000023', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '77770000-0000-4000-8000-000000000031', '77770000-0000-4000-8000-000000000001',
  '77770000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Producto Own'), 50000, true, 'avail-socio-own'
);

set local role authenticated;

-- Socio operator actif sur son propre établissement → succès, écrit product_availability +
-- product_calendar dans la même transaction --------------------------------------------------
select test_login('77770000-0000-4000-8000-000000000021');

select is(
  (select set_product_availability(
     '77770000-0000-4000-8000-000000000031'::uuid, '2027-05-01'::date, 6, true
   )->>'ok'),
  'true',
  'socio operator actif sur son propre établissement réussit'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_availability
    where product_id = '77770000-0000-4000-8000-000000000031' and date = '2027-05-01'),
  jsonb_build_object('capacity', 6, 'booked', 0),
  'product_availability créée avec la bonne capacité'
);
select is(
  (select open from product_calendar
    where product_id = '77770000-0000-4000-8000-000000000031' and date = '2027-05-01'),
  true,
  'product_calendar créée dans la même transaction'
);

-- Preuve du conditionnement : AUCUNE ligne audit_log créée par l'appel socio ci-dessus (vérifié
-- sous l'admin, seul rôle qui peut lire audit_log) --------------------------------------------
select test_login('77770000-0000-4000-8000-000000000023');
-- Scopé au produit de l'appel socio, jamais en absolu (audit_log d'une base seedée n'est pas vide).
select is(
  (select count(*) from audit_log where entity_id = '77770000-0000-4000-8000-000000000031')::int, 0,
  'aucune ligne audit_log créée par l''appel socio (preuve du conditionnement à v_is_admin)'
);

-- Socio sur le produit d'un AUTRE partenaire → product_not_found --------------------------------
select test_login('77770000-0000-4000-8000-000000000022');
select is(
  (select set_product_availability(
     '77770000-0000-4000-8000-000000000031'::uuid, '2027-05-02'::date, 4
   )->>'reason'),
  'product_not_found',
  'socio sur le produit d''un autre partenaire → product_not_found'
);

-- Capacité suspendue → capability_suspended (own, temporairement, cf. product_proposals.test.sql
-- pour le même patron) --------------------------------------------------------------------------
reset role;
update partner_capabilities set status = 'suspended'
 where partner_id = '77770000-0000-4000-8000-000000000001' and role = 'operator';
set local role authenticated;
select test_login('77770000-0000-4000-8000-000000000021');

select is(
  (select set_product_availability(
     '77770000-0000-4000-8000-000000000031'::uuid, '2027-05-03'::date, 4
   )->>'reason'),
  'capability_suspended',
  'capacité operator suspendue pour cet établissement → capability_suspended'
);

reset role;
update partner_capabilities set status = 'active'
 where partner_id = '77770000-0000-4000-8000-000000000001' and role = 'operator';
set local role authenticated;

-- Admin → comportement inchangé, AVEC une ligne audit_log cette fois (non-régression) -----------
select test_login('77770000-0000-4000-8000-000000000023');

select is(
  (select set_product_availability(
     '77770000-0000-4000-8000-000000000031'::uuid, '2027-05-04'::date, 9, true, 'admin-note'
   )->>'ok'),
  'true',
  'admin réussit toujours (chemin admin inchangé)'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_availability
    where product_id = '77770000-0000-4000-8000-000000000031' and date = '2027-05-04'),
  jsonb_build_object('capacity', 9, 'booked', 0),
  'product_availability écrite par l''admin'
);
select is(
  (select count(*) from audit_log where note = 'admin-note')::int, 1,
  'une ligne audit_log créée par l''appel admin (non-régression)'
);
select is(
  (select jsonb_build_object('action', action, 'after', after) from audit_log where note = 'admin-note'),
  jsonb_build_object(
    'action', 'product.set_availability',
    'after', jsonb_build_object('date', '2027-05-04', 'capacity', 9, 'open', true)
  ),
  'audit_log enregistre action/after corrects pour l''appel admin'
);

-- ===== capacity_exceeds_physical (20260827230000) ==============================================
-- Garde-fou porté depuis set_room_type_availability, supprimée avec les chambres par T3 étape 2.
-- Trois cas, parce que la formule DÉPEND du type de couchage et qu'une seule d'entre elles était
-- couverte du temps des chambres.
reset role;
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                      lodging_kind, capacity, unit_count)
values
  -- Dortoir : 6 lits × 2 unités = 12 places vendables.
  ('77770000-0000-4000-8000-000000000041', '77770000-0000-4000-8000-000000000001',
   '77770000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Dormitorio Fisico'),
   20000, true, 'avail-socio-dorm', 'dorm', 6, 2),
  -- Privée : 3 chambres, et la capacité par chambre n'entre PAS dans le calcul — on vend la
  -- chambre, pas le lit. C'est exactement la distinction que la formule encode.
  ('77770000-0000-4000-8000-000000000042', '77770000-0000-4000-8000-000000000001',
   '77770000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Privada Fisica'),
   90000, true, 'avail-socio-priv', 'private', 2, 3),
  -- Logement sans unit_count : rien à quoi se comparer, le garde ne doit pas s'armer.
  ('77770000-0000-4000-8000-000000000043', '77770000-0000-4000-8000-000000000001',
   '77770000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Sin Unidades'),
   90000, true, 'avail-socio-nounits', 'private', 2, null);
set local role authenticated;
select test_login('77770000-0000-4000-8000-000000000021');

select is(
  (set_product_availability('77770000-0000-4000-8000-000000000041', '2027-06-01', 13)->>'reason'),
  'capacity_exceeds_physical',
  'dortoir : 13 > 6 lits × 2 unités → refusé'
);
select is(
  (set_product_availability('77770000-0000-4000-8000-000000000041', '2027-06-01', 12)->>'ok')::boolean,
  true,
  'dortoir : 12 = exactement la capacité physique → accepté (borne inclusive)'
);
select is(
  (set_product_availability('77770000-0000-4000-8000-000000000042', '2027-06-01', 4)->>'reason'),
  'capacity_exceeds_physical',
  'privée : 4 > 3 unités → refusé (la capacité par chambre n''entre pas dans le calcul)'
);
select is(
  (set_product_availability('77770000-0000-4000-8000-000000000042', '2027-06-01', 3)->>'ok')::boolean,
  true,
  'privée : 3 unités → accepté, jamais 3 × capacity'
);
select is(
  (set_product_availability('77770000-0000-4000-8000-000000000043', '2027-06-01', 99)->>'ok')::boolean,
  true,
  'logement sans unit_count : le garde ne s''arme pas, comportement inchangé'
);
select is(
  (set_product_availability('77770000-0000-4000-8000-000000000031', '2027-06-01', 99)->>'ok')::boolean,
  true,
  'activité : aucun unit_count, chemin strictement inchangé'
);

-- Le cas qui manquait, et que la revue /simplify a trouvé : lodging_kind est FACULTATIVE. Elle vaut
-- null sur tout logement dont le socio n'a pas renseigné le type — c'était le cas des cinq
-- logements existants au moment d'écrire ceci. La première version du garde (20260827230000)
-- exigeait `lodging_kind is not null` pour s'armer : elle ne protégeait donc à peu près personne.
-- Corrigé par 20260827250000, armé sur unit_count seul.
reset role;
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                      lodging_kind, capacity, unit_count)
values ('77770000-0000-4000-8000-000000000044', '77770000-0000-4000-8000-000000000001',
        '77770000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Sin Tipo'),
        50000, true, 'avail-socio-notype', null, 4, 2);
set local role authenticated;
select test_login('77770000-0000-4000-8000-000000000021');

select is(
  (set_product_availability('77770000-0000-4000-8000-000000000044', '2027-06-01', 999)->>'reason'),
  'capacity_exceeds_physical',
  'lodging_kind null : le garde s''arme QUAND MÊME (unit_count suffit) — le cas que la v1 ratait'
);
select is(
  (set_product_availability('77770000-0000-4000-8000-000000000044', '2027-06-01', 8)->>'ok')::boolean,
  true,
  'lodging_kind null : borne HAUTE retenue (2 × 4 = 8), pour ne pas bloquer un dortoir non typé'
);

select * from finish();
rollback;
