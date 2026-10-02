-- product_slot_rules devient RPC-only en écriture (CLAUDE.md §3, forme de .claude/rules/supabase.md).
--
-- ⚠️ MIGRATION À POUSSER APRÈS le déploiement du code qui écrit les règles par la RPC
-- replace_product_slot_rules (20261001235031) — ProductSlotRulesBlock.tsx et la création dans
-- product-form.tsx. Poussée avant, l'enregistrement des horaires échouerait en « permission
-- denied » tant que le code en ligne écrit encore la table directement.
--
-- Pourquoi : remplacer les règles en deux requêtes depuis le navigateur pouvait laisser une activité
-- sans aucune règle, donc invendable. Tant que l'écriture directe restait ouverte (policy
-- product_slot_rules_write_admin), rien n'empêchait ce chemin de revenir ; le seul passage est
-- désormais la RPC, qui remplace tout en une transaction. scripts/check-slot-rules-access.sh
-- empêche une écriture directe de réapparaître dans le code. La lecture (policy
-- product_slot_rules_select) est inchangée : la vitrine et l'admin lisent les règles directement.
drop policy product_slot_rules_write_admin on public.product_slot_rules;
revoke insert, update, delete on public.product_slot_rules from authenticated, anon;
