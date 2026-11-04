-- Feature 31 (docs/specs/07-connexion-inscription-complete.md §8/§10) — 2FA admin : exigence d'AAL2
-- CONDITIONNELLE (décision Gabriel, 2026-10-30, après constat que le 2FA « optionnel » du
-- 2026-08-15 ne protégeait rien : is_admin() ne regardait plus l'AAL, donc un admin ayant activé son
-- 2FA restait pleinement admin avec une session mot de passe seul).
--
-- is_admin(uid) exige désormais l'AAL2 de la session COURANTE (auth.jwt(), pas un paramètre) SEULEMENT
-- si le compte a un facteur MFA VÉRIFIÉ. Un admin qui n'a rien activé — ou qui a abandonné un
-- enrôlement (facteur resté `unverified`) — n'est jamais bloqué : c'est l'obligation générale du
-- 2026-08-12 (20260815250000_admin_2fa_aal2.sql) qui avait verrouillé l'accès admin réel, pas le
-- principe d'une exigence pour qui a choisi de se protéger.
--
-- Tous les types de facteur comptent (totp, phone, webauthn) : la règle porte sur « a-t-il activé
-- un second facteur », pas sur lequel. Même chokepoint qu'en 20260815250000 — is_admin(uid) reste LA
-- définition unique (les surcharges sans paramètre de 20261014204210 y délèguent) et ses appelants
-- passent tous l'appelant lui-même (auth.uid()). Pour un uid tiers, la règle échoue fermée
-- (admin enrôlé et appelant en AAL1 → faux), jamais ouverte.
--
-- has_admin_capability(uid) reste volontairement SANS exigence d'AAL2 : « ce compte est admin » doit se
-- savoir AVANT que l'AAL2 soit atteinte (aujourd'hui : /mfa/enroll n'enrôle que la capacité admin).
-- Le garde applicatif (apps/admin/lib/mfaGuard.ts) n'en dépend plus : il lit le niveau d'assurance.
--
-- create or replace conserve les droits (20261014204647 : EXECUTE retiré à anon et authenticated, la
-- fonction n'est appelée que par les SECURITY DEFINER et par la surcharge sans paramètre).
-- coalesce(..., 'aal1') : une session sans claim aal est traitée comme AAL1, jamais l'inverse.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_admin_capability(uid)
    and (
      not exists (
        select 1
        from auth.mfa_factors f
        where f.user_id = uid
          and f.status = 'verified'
      )
      or coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
    );
$$;
