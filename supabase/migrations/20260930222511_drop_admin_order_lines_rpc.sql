-- Suppression des cinq lectures ligne à ligne de l'accueil admin (20260922160000), remplacées par
-- les agrégats admin_dashboard_* (20260930221527).
--
-- ⚠️ MIGRATION DESTRUCTIVE, À POUSSER APRÈS le déploiement du code qui ne les appelle plus
-- (apps/admin/app/admin/page.tsx). Poussée avant, ou dans le même `db push` que 20260930221527,
-- elle casserait l'accueil admin pendant la fenêtre où le code encore en ligne les appelle.
--
-- Plus aucun appelant : ni SQL (aucune fonction de `public` ne les cite), ni TypeScript (seul
-- admin/page.tsx les appelait). Leur test, admin_dashboard_order_lines.test.sql, est supprimé dans
-- le même commit ; admin_dashboard.test.sql couvre les agrégats qui les remplacent.
drop function public.admin_order_lines_revenue_rows();
drop function public.admin_order_lines_commission_rows();
drop function public.admin_order_lines_pending_action_count(date);
drop function public.admin_order_lines_daily_series(date);
drop function public.admin_order_lines_volume_by_partner_rows();
