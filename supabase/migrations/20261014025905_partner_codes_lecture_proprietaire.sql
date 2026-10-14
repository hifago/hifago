-- Codes partenaires : lecture limitée à leur propriétaire et à l'admin, vérification d'un code à
-- l'unité (étape 1 sur 2, ADDITIVE).
--
-- Jusqu'ici partner_codes n'avait qu'une policy de lecture, partner_codes_select_public
-- (`using (true)`, 20260813163456) : un code devait pouvoir se vérifier avant toute inscription.
-- Arbitrage du 2026-10-13 : un code se vérifie désormais UN PAR UN, et seuls son propriétaire et
-- l'admin lisent les lignes de la table.
--
-- Cette migration AJOUTE seulement, sans rien retirer : le code déployé avant elle continue de lire
-- comme avant pendant la mise en ligne.
--   1. partner_code_is_active(code) : rend si un code existe et est actif, rien d'autre (un booléen,
--      jamais de liste ni de partenaire). C'est le seul besoin d'un visiteur anonyme : la route
--      /[locale]/r/[code] des liens et QR imprimés. SECURITY DEFINER (elle lit une table dont anon
--      perdra la lecture), STABLE, search_path vide ; EXECUTE pour anon et authenticated seulement.
--      Même règle que create_order pour un code d'attribution (`code = … and active`).
--   2. partner_codes_select_own : un partenaire lit les codes de SON organisation (écran « Mi enlace
--      y QR », apps/admin/app/partner/(app)/tools).
--   3. partner_codes_select_admin : l'admin lit tout (fiche partenaire).
-- Le retrait de partner_codes_select_public et du SELECT d'anon est l'étape 2, une migration
-- séparée, poussée APRÈS le déploiement du code qui passe par la fonction ci-dessus.
--
-- Les fonctions qui lisent la table (create_order, create_partner_direct, create_partner_invitation,
-- consume_partner_invitation, set_partner_code_active) sont toutes SECURITY DEFINER : elles ne
-- dépendent d'aucune de ces policies.

create function public.partner_code_is_active(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.partner_codes where code = p_code and active
  );
$$;

revoke all on function public.partner_code_is_active(text) from public, anon, authenticated;
grant execute on function public.partner_code_is_active(text) to anon, authenticated;

create policy partner_codes_select_own on public.partner_codes
  for select
  to authenticated
  using (partner_id = (select public.partner_id_for_account(auth.uid())));

create policy partner_codes_select_admin on public.partner_codes
  for select
  to authenticated
  using ((select public.is_admin(auth.uid())));
