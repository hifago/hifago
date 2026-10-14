-- Recherche datée et connecteur LobbyPMS coupé (20261014030722, arbitrage G30 = A).
--
-- Un logement adossé à Lobby (lodging + lobby_category_id) dont l'établissement a le connecteur
-- coupé disparaît d'une recherche AVEC dates, et seulement d'elle. Deux témoins : un logement local
-- (sans catégorie Lobby) d'un établissement au connecteur coupé reste visible avec dates, et le même
-- logement Lobby redevient visible dès que le connecteur est rétabli (repli optimiste d'un miroir
-- jamais synchronisé). Toujours scopé par p_query (jeton « ConectorCortado ») : jamais un
-- search_catalog() nu, qui lirait le catalogue entier.
begin;
select plan(4);

insert into partners (id, display_name) values
  ('a7000000-0000-4000-8000-000000000001', 'Conector Cortado Partner');
insert into establishments (id, partner_id, name, status, lobby_connector_active) values
  ('a7000000-0000-4000-8000-000000000011', 'a7000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento ConectorCortado Lobby'), 'active', false),
  ('a7000000-0000-4000-8000-000000000012', 'a7000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento ConectorCortado Local'), 'active', false);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('a7000000-0000-4000-8000-000000000021', 'a7000000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Alojamiento ConectorCortado Lobby'), 90000, true, 'conector-cortado-lobby-test', 991001),
  ('a7000000-0000-4000-8000-000000000022', 'a7000000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000012', 'lodging',
   jsonb_build_object('es', 'Alojamiento ConectorCortado Local'), 90000, true, 'conector-cortado-local-test', null);

set local role anon;
select set_config('request.jwt.claims', '', true);

select ok(
  exists (select 1 from search_catalog(p_query => 'ConectorCortado', p_limite => 1000)
           where id = 'a7000000-0000-4000-8000-000000000021'),
  'sans dates : le logement Lobby au connecteur coupé reste au catalogue (sa fiche dit qu''il ne se réserve pas)'
);
select ok(
  not exists (select 1 from search_catalog(p_query => 'ConectorCortado', p_desde => '2027-02-10',
                                           p_hasta => '2027-02-12', p_limite => 1000)
               where id = 'a7000000-0000-4000-8000-000000000021'),
  'avec dates : le logement Lobby au connecteur coupé n''apparaît plus'
);
select ok(
  exists (select 1 from search_catalog(p_query => 'ConectorCortado', p_desde => '2027-02-10',
                                       p_hasta => '2027-02-12', p_limite => 1000)
           where id = 'a7000000-0000-4000-8000-000000000022'),
  'témoin : avec dates, un logement local (sans catégorie Lobby) reste visible'
);

reset role;
update establishments set lobby_connector_active = true, lobby_api_token = 'conector-cortado-token'
 where id = 'a7000000-0000-4000-8000-000000000011';
set local role anon;
select ok(
  exists (select 1 from search_catalog(p_query => 'ConectorCortado', p_desde => '2027-02-10',
                                       p_hasta => '2027-02-12', p_limite => 1000)
           where id = 'a7000000-0000-4000-8000-000000000021'),
  'témoin : connecteur rétabli (miroir jamais synchronisé, repli optimiste), le logement Lobby revient'
);
reset role;

select * from finish();
rollback;
