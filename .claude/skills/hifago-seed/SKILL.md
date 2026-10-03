---
name: hifago-seed
description: Régénère ou applique les données synthétiques de supabase/seed.sql pour le nouveau stack Hifago (établissements PMS/non-PMS, grilles tarifaires, comptes à statuts variés, commandes dans divers états, contenu multilingue d'exemple) — jamais de copie de production ni de PII réelle. Invocation Codex — $hifago-seed ou $hifago-seed preprod
---

# /hifago-seed — données synthétiques

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| *(vide)* | Applique `supabase/seed.sql` en local en 3 étapes (cf. Procédure — depuis 2026-08-21, un simple `db reset` ne suffit plus) |
| `preprod` | Confirme d'abord la cible (cf. `/hifago-verify-compte`), puis applique le même seed en 3 étapes sur le projet Supabase préprod |

## Règle non négociable (`CLAUDE.md` §7.3)
Jamais de copie de données de production, jamais de PII réelle — ni en local, ni en préprod ;
tout `supabase/seed.sql` est généré.

## Contenu attendu du seed (à maintenir représentatif du cahier des charges)
- Établissements PMS-backed et non-PMS-backed (au moins un de chaque, pour exercer les deux
  chemins de disponibilité).
- Chambres/produits avec grille tarifaire par date (pas seulement un prix unique — sinon le gap
  critique documenté dans `docs/04-architecture-cible.md` n'est jamais exercé par les tests).
- Comptes partenaires à statuts de capacité variés (en préparation / en revue / suspendue /
  active) — pas seulement des comptes "actifs", sinon la logique de statut n'est jamais testée.
- Commandes dans plusieurs états (réservée, réalisée, absence, annulée, expirée) pour exercer le
  moteur de commission et le ledger.
- Codes promo avec des politiques de réutilisation différentes (à vie / usage unique).
- Contenu multilingue d'exemple couvrant les trois cas : fiche avec ES+EN, fiche avec ES seul
  (teste le repli), fiche avec une langue non routée en plus (teste le canonical vers `x-default`,
  cf. `CLAUDE.md` § 5).

## Procédure
1. Écrire/mettre à jour `supabase/seed.sql` en respectant le contenu attendu ci-dessus. Les comptes
   `auth.users` du seed ne s'insèrent plus en SQL direct dedans (bloqué sur Supabase Cloud,
   `permission denied for schema auth` — constaté 2026-08-21, pas un grant manquant) : les ajouter
   plutôt dans `supabase/scripts/seed_auth_users.mjs` (API Admin Auth, UUID fixe par compte).
2. Local : `npm run db:setup` (depuis `hifago/`). ⚠️ Ne PAS recopier les trois étapes ici :
   `scripts/db-setup.sh` se déclare en toutes lettres « le seul endroit où [l'ordre] est écrit une
   fois pour toutes », et un ordre écrit à deux endroits finit par diverger. Ce que le script fait,
   pour comprendre sans l'ouvrir : migrations seules (`db reset --no-seed`), puis les comptes
   `auth.users` par l'API Admin, puis `seed.sql` — un `db reset` seul échouerait sur les clés
   étrangères vers des `auth.users` pas encore créés.
   ⚠️ `db reset` EFFACE la base locale, partagée par toutes les sessions ouvertes sur ce dépôt.
3. Préprod : d'abord `/hifago-verify-compte` pour confirmer qu'on cible bien le projet préprod du
   projet Hifago (jamais par défaut, jamais sans cette vérification), puis les mêmes 3 étapes
   contre ce projet : `supabase db push` si des migrations manquent, puis `seed_auth_users.mjs`
   avec les credentials cloud en variable de session (jamais dans un fichier, cf.
   `CLAUDE.md` §8.2), puis `seed.sql` par `mcp__supabase__execute_sql` ou un `psql` direct
   authentifié `postgres`.
   ⚠️ **JAMAIS `supabase db push --include-seed` pour le seed** : `CLAUDE.md` §11 point 17
   documente l'échec, constaté le 2026-08-21 — le CLI provisionne un rôle éphémère
   `cli_login_postgres` qui affiche `current_user='postgres'` mais n'en a pas les droits effectifs,
   et l'insertion échoue en `permission denied`. `db push` reste fiable pour les migrations (DDL),
   pas pour ce seed.

## Ce qui est normal, ne pas le signaler comme un problème
Le seed grossit au fil du chantier à mesure que de nouveaux cas limites sont identifiés — c'est
voulu, pas une dérive à corriger.

## Données de test rejouables sans reset
Pour ajouter des établissements/activités/tags/partenaires de test SANS `db reset` (donc sans
perdre le travail en cours, y compris en préprod) : `/hifago-mock-data`, pas ce skill-ci — mécanisme
JSON dans `mockData/`, create-if-missing, jamais un reset.
