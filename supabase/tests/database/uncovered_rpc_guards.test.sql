-- Chemins de REFUS des RPC exposées qu'aucun pgTAP ne couvrait (audit P12g, décision D5 du
-- 2026-10-06 : version minimale, les chemins heureux restent au backlog de chaque fonctionnalité).
-- Dix fonctions exécutables par `authenticated` et qui ÉCRIVENT : appelées ici par l'operator d'un
-- AUTRE établissement (ni admin, ni propriétaire), chacune doit refuser — exception exacte ou
-- `{ok: false, reason}` exact — et ne rien écrire.
--
-- Deux d'entre elles sont SECURITY INVOKER (update_establishment, update_establishment_stay_details) :
-- leur seul garde est la RLS (establishments_write_admin). Les huit autres sont SECURITY DEFINER et
-- portent un garde explicite (is_admin, ou propriété + has_capability).
begin;
select plan(11);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : le propriétaire (partenaire …01, établissement …11, produit …21 avec deux photos) et
-- l'operator d'un autre établissement (partenaire …02, établissement …12), qui appelle tout.
insert into partners (id, display_name) values
  ('a5000000-0000-4000-8000-000000000001', 'Refus P12g Propriétaire'),
  ('a5000000-0000-4000-8000-000000000002', 'Refus P12g Autre');
insert into establishments (id, partner_id, name) values
  ('a5000000-0000-4000-8000-000000000011', 'a5000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Refus P12g')),
  ('a5000000-0000-4000-8000-000000000012', 'a5000000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Refus P12g Otro'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('a5000000-0000-4000-8000-000000000021', 'a5000000-0000-4000-8000-000000000001',
   'a5000000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Refus P12g'), 50000, true, 'refus-p12g-test');
insert into product_media (id, product_id, storage_path, sort) values
  ('a5000000-0000-4000-8000-000000000041', 'a5000000-0000-4000-8000-000000000021', 'refus-p12g/1.webp', 0),
  ('a5000000-0000-4000-8000-000000000042', 'a5000000-0000-4000-8000-000000000021', 'refus-p12g/2.webp', 1);

insert into auth.users (id, email) values
  ('a5000000-0000-4000-8000-000000000031', 'refus-p12g-owner@test.local'),
  ('a5000000-0000-4000-8000-000000000032', 'refus-p12g-other@test.local');
update partner_accounts set partner_id = 'a5000000-0000-4000-8000-000000000001'
 where id = 'a5000000-0000-4000-8000-000000000031';
update partner_accounts set partner_id = 'a5000000-0000-4000-8000-000000000002'
 where id = 'a5000000-0000-4000-8000-000000000032';
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('a5000000-0000-4000-8000-000000000001', 'referrer', null, 'migration', 'active'),
  ('a5000000-0000-4000-8000-000000000001', 'operator', 'a5000000-0000-4000-8000-000000000011', 'migration', 'active'),
  ('a5000000-0000-4000-8000-000000000002', 'referrer', null, 'migration', 'active'),
  ('a5000000-0000-4000-8000-000000000002', 'operator', 'a5000000-0000-4000-8000-000000000012', 'migration', 'active');

insert into partner_invitations (id, token_hash, promo_code, onboarding_path, expires_at) values
  ('a5000000-0000-4000-8000-000000000051', 'refus-p12g-hash', 'REFUSP12G', 'referrer', now() + interval '7 days');

set local role authenticated;
select test_login('a5000000-0000-4000-8000-000000000032');

-- Réservées à l'admin : 42501, message exact ----------------------------------------------------
select throws_ok(
  $$ select add_catalog_media('product', 'a5000000-0000-4000-8000-000000000021'::uuid, 'refus-p12g/3.webp', 2) $$,
  '42501'::char(5), 'add_catalog_media réservé au rôle admin',
  'add_catalog_media refuse un non-admin'
);
select throws_ok(
  $$ select create_partner_direct(p_display_name => 'Refus P12g Fantôme', p_roles => array['referrer'],
                                  p_send_invitation => false) $$,
  '42501'::char(5), 'create_partner_direct réservé au rôle admin',
  'create_partner_direct refuse un non-admin'
);
select throws_ok(
  $$ select provision_evento_availability('a5000000-0000-4000-8000-000000000021'::uuid, interval '30 days') $$,
  '42501'::char(5), 'provision_evento_availability réservé au rôle admin',
  'provision_evento_availability refuse un non-admin'
);
select throws_ok(
  $$ select revoke_partner_invitation('a5000000-0000-4000-8000-000000000051'::uuid) $$,
  '42501'::char(5), 'revoke_partner_invitation réservé au rôle admin',
  'revoke_partner_invitation refuse un non-admin'
);

-- Réservées au propriétaire : refus explicite, jamais la révélation de l'existence ----------------
select is(
  reorder_gallery('product', 'a5000000-0000-4000-8000-000000000021'::uuid,
                  array['a5000000-0000-4000-8000-000000000042', 'a5000000-0000-4000-8000-000000000041']::uuid[]) ->> 'reason',
  'not_authorized',
  'reorder_gallery refuse l''operator d''un autre établissement'
);
select is(
  submit_establishment_edit_proposal('a5000000-0000-4000-8000-000000000011'::uuid,
                                     jsonb_build_object('name', jsonb_build_object('es', 'Usurpé'))) ->> 'reason',
  'establishment_not_found',
  'submit_establishment_edit_proposal refuse un non-propriétaire (même réponse qu''un id inconnu)'
);
select is(
  submit_establishment_photos_proposal('a5000000-0000-4000-8000-000000000011'::uuid, array['refus-p12g/x.webp']) ->> 'reason',
  'establishment_not_found',
  'submit_establishment_photos_proposal refuse un non-propriétaire'
);
select is(
  submit_photos_proposal('a5000000-0000-4000-8000-000000000021'::uuid, array['refus-p12g/y.webp']) ->> 'reason',
  'product_not_found',
  'submit_photos_proposal refuse un non-propriétaire (même réponse qu''un produit inconnu)'
);

-- SECURITY INVOKER : la RLS est le seul garde --------------------------------------------------
select is(
  update_establishment_stay_details('a5000000-0000-4000-8000-000000000011'::uuid, '15:00', '11:00', 'rooms') ->> 'reason',
  'establishment_not_found',
  'update_establishment_stay_details refuse un non-admin (RLS, INVOKER)'
);
select throws_ok(
  $$ select update_establishment('a5000000-0000-4000-8000-000000000011'::uuid,
                                 jsonb_build_object('es', 'Usurpé'), null, null, null, null, null) $$,
  'P0001'::char(5), 'établissement introuvable ou non autorisé',
  'update_establishment refuse un non-admin (RLS, INVOKER)'
);

-- Rien n'a été écrit par les dix refus ci-dessus ------------------------------------------------
reset role;
select is(
  jsonb_build_object(
    'photos', (select jsonb_agg(jsonb_build_object('id', id, 'sort', sort) order by id)
                 from product_media where product_id = 'a5000000-0000-4000-8000-000000000021'),
    'partenaire_fantome', (select count(*) from partners where display_name = 'Refus P12g Fantôme'),
    'disponibilites', (select count(*) from product_availability where product_id = 'a5000000-0000-4000-8000-000000000021'),
    'invitation', (select status from partner_invitations where id = 'a5000000-0000-4000-8000-000000000051'),
    'propositions_etablissement', (select count(*) from establishment_proposals
                                    where establishment_id = 'a5000000-0000-4000-8000-000000000011'),
    'propositions_produit', (select count(*) from product_proposals
                              where product_id = 'a5000000-0000-4000-8000-000000000021'),
    'etablissement', (select jsonb_build_object('name', name, 'check_in_time', check_in_time, 'mode', mode)
                        from establishments where id = 'a5000000-0000-4000-8000-000000000011')
  ),
  jsonb_build_object(
    'photos', jsonb_build_array(
      jsonb_build_object('id', 'a5000000-0000-4000-8000-000000000041', 'sort', 0),
      jsonb_build_object('id', 'a5000000-0000-4000-8000-000000000042', 'sort', 1)),
    'partenaire_fantome', 0,
    'disponibilites', 0,
    'invitation', 'pending',
    'propositions_etablissement', 0,
    'propositions_produit', 0,
    'etablissement', jsonb_build_object('name', jsonb_build_object('es', 'Establecimiento Refus P12g'),
                                        'check_in_time', null, 'mode', null)
  ),
  'aucun des dix refus n''a écrit quoi que ce soit (photos, partenaire, disponibilités, invitation, propositions, établissement)'
);

select * from finish();
rollback;
