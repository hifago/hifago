-- Fonctions d'identité lues sur l'appelant (étape 2 sur 2, DESTRUCTIVE — à pousser APRÈS le
-- déploiement du code de l'étape 1, 20261014204210).
--
-- L'étape 1 a posé les surcharges sans paramètre (is_admin(), has_admin_capability(),
-- partner_id_for_account(), has_capability(p_role, p_establishment_id)), basculé dessus toutes les
-- policies de public et de storage, et l'application. Les versions À PARAMÈTRE ne sont plus
-- exécutables par anon ni authenticated : elles ne restent appelées que par les fonctions SECURITY
-- DEFINER (exécutées en propriétaire), qui n'en dépendent donc pas. identite_appelant.test.sql
-- prouve qu'aucune policy, vue ni fonction SECURITY INVOKER ne les appelle encore.

revoke all on function public.is_admin(uuid) from public, anon, authenticated;
revoke all on function public.has_admin_capability(uuid) from public, anon, authenticated;
revoke all on function public.partner_id_for_account(uuid) from public, anon, authenticated;
revoke all on function public.has_capability(uuid, text, uuid) from public, anon, authenticated;
