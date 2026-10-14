-- Codes partenaires : lecture limitée à leur propriétaire et à l'admin (étape 2 sur 2,
-- DESTRUCTIVE — à pousser APRÈS le déploiement du code de l'étape 1, 20261014025905).
--
-- L'étape 1 a posé partner_code_is_active (vérification d'un code à l'unité) et les policies de
-- lecture propriétaire et admin, et basculé la seule lecture anonyme (/[locale]/r/[code]) sur la
-- fonction. Cette étape retire ce qui n'a plus de lecteur :
--   - partner_codes_select_public (`using (true)`, 20260813163456) ;
--   - le SELECT d'anon sur la table : un visiteur sans compte ne lit plus aucune ligne, il vérifie
--     un code par partner_code_is_active.
-- authenticated GARDE son SELECT : les policies partner_codes_select_own et
-- partner_codes_select_admin en filtrent les lignes (son organisation, ou tout pour l'admin).
-- Les fonctions SECURITY DEFINER qui lisent la table (create_order, create_partner_direct,
-- create_partner_invitation, consume_partner_invitation, set_partner_code_active) n'en dépendent pas.

drop policy partner_codes_select_public on public.partner_codes;

revoke select on public.partner_codes from anon;
