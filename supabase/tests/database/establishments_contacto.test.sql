-- Spec 30 (Tranche 2) — le contact d'un établissement, posé PUBLIC par
-- 20260908202000_establishments_contacto_publico.sql, rendu PRIVÉ par
-- 20261019170000_establishment_whatsapp_prive.sql (décision Jérôme du 2026-10-19 : le WhatsApp du
-- prestataire n'apparaît jamais avant que le client ait finalisé sa réservation). La sortie du
-- numéro après réservation est prouvée dans establishment_whatsapp_prive.test.sql.
--
-- Ce fichier tient DEUX choses distinctes, et le mélange serait une erreur :
--   • la CONTRAINTE de format, exercée en `postgres` — en `anon`, une policy refuserait l'écriture
--     avant que la contrainte n'ait son mot à dire, et le test prouverait la policy (leçon du slug
--     réservé, spec 29 §10ter) ;
--   • les DROITS réels d'un visiteur, exercés en `anon`.
begin;
select plan(8);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88930000-0000-4000-8000-000000000001', 'Contacto Test Partner');

-- Un vrai compte admin : `update_establishment_contact` est `security invoker` ET journalise via
-- `log_admin_action`, qui refuse tout ce qui n'est pas admin. En `postgres`, `auth.uid()` est nul
-- et la RPC échoue — donc la tester en superuser ne prouverait rien de ce qui se passe en vrai.
insert into auth.users (id, email) values
  ('88930000-0000-4000-8000-000000000031', 'contacto-admin@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('88930000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into establishments (id, partner_id, name, status) values
  ('88930000-0000-4000-8000-000000000011', '88930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Contacto Test'), 'active');
-- Un produit vendable : sans lui, `establishments_select_public` cache l'établissement entier, et
-- l'assertion de lecture anonyme ci-dessous échouerait pour la mauvaise raison.
insert into products (id, partner_id, establishment_id, type, slug, name, price_cop, sellable) values
  ('88930000-0000-4000-8000-000000000021', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000011', 'activity', 'contacto-test-actividad',
   jsonb_build_object('es', 'Actividad'), 50000, true);

-- ── La contrainte de format, en postgres ───────────────────────────────────────────────────────
select lives_ok(
  $$ update public.establishments set contact_phone = '+573001234567'
      where id = '88930000-0000-4000-8000-000000000011' $$,
  'un numéro colombien (+57 et 10 chiffres) est accepté'
);

select throws_ok(
  $$ update public.establishments set contact_phone = '+33612345678'
      where id = '88930000-0000-4000-8000-000000000011' $$,
  '23514'::char(5),
  null,
  'un numéro E.164 étranger est REFUSÉ depuis 20261019170000 (establishments_contact_phone_colombia)'
);

select throws_ok(
  $$ update public.establishments set contact_phone = '300 123 45 67'
      where id = '88930000-0000-4000-8000-000000000011' $$,
  '23514'::char(5),
  null,
  'un numéro mis en forme est refusé — wa.me/<numéro> produirait un lien mort'
);

-- ── Les droits réels d'un visiteur anonyme ─────────────────────────────────────────────────────
set local role anon;

-- ⚠️ L'ASSERTION QUI ATTRAPE UN `grant select` REMIS PAR MÉGARDE. L'établissement est public (actif,
-- un produit vendable) : la RLS laisse passer la ligne, seul le retrait du grant colonne protège le
-- numéro. Le refus tombe AVANT la RLS (piège §11.1) — c'est précisément ce qu'on veut ici.
select throws_ok(
  $$ select contact_phone from public.establishments
      where id = '88930000-0000-4000-8000-000000000011' $$,
  '42501'::char(5),
  null,
  'anon NE LIT PLUS le WhatsApp d''un établissement public (20261019170000)'
);

-- ⚠️ Mesuré le 2026-09-08 : `anon` a le grant UPDATE sur cette colonne, hérité du niveau TABLE. Le
-- seul rempart est la policy `establishments_write_admin`. L'UPDATE ne LÈVE PAS : la policy ne voit
-- simplement aucune ligne — côté client, ça ressemble à un succès.
select lives_ok(
  $$ update public.establishments set contact_phone = '+570000000000'
      where id = '88930000-0000-4000-8000-000000000011' $$,
  'la tentative d''écriture anonyme ne lève aucune erreur — elle est simplement sans effet'
);

reset role;

select is(
  (select contact_phone from public.establishments
    where id = '88930000-0000-4000-8000-000000000011'),
  '+573001234567',
  'anon N''A RIEN ÉCRIT, malgré un grant UPDATE hérité du niveau table — la RLS tient seule'
);

-- ── La RPC d'écriture, dans les conditions réelles : un admin authentifié ──────────────────────
set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000031');
select is(
  public.update_establishment_contact(
    '88930000-0000-4000-8000-000000000011', '+33612345678') ->> 'reason',
  'invalid_phone',
  'la RPC refuse un numéro non colombien par un motif lisible, jamais par une exception SQL'
);

-- Le numéro est obligatoire depuis le 2026-10-19 : un champ vidé est REFUSÉ, il n'efface plus.
select is(
  public.update_establishment_contact('88930000-0000-4000-8000-000000000011', '   ') ->> 'reason',
  'phone_required',
  'une chaîne vide ou blanche est refusée au lieu d''effacer le contact'
);

reset role;

select * from finish();
rollback;
