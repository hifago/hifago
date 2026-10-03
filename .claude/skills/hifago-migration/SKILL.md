---
name: hifago-migration
description: Crée ou valide une migration Supabase pour le nouveau stack Hifago en appliquant la checklist RLS/RPC-only non négociable (grants revoke, STABLE, SECURITY DEFINER, search_path, auth.uid() enveloppé), applique en local et régénère les types TypeScript. Invocation Codex — $hifago-migration [nom] ou $hifago-migration check
---

# /hifago-migration — créer/valider une migration Supabase

Rend exécutable la checklist RLS/RPC-only de `CLAUDE.md` § 3 — à appliquer à **chaque**
nouvelle table ou fonction, pas seulement aux cas évidents.

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| `<nom>` | Crée `supabase/migrations/<timestamp>_<nom>.sql`, guide la rédaction avec la checklist ci-dessous |
| `check` | Audite les migrations déjà écrites contre la même checklist, sans en créer de nouvelle |

## Checklist non négociable

C'est `CLAUDE.md` §3 (toujours chargé) ; sa forme exécutable — snippet RPC-only, `stable`,
`security definer` + `search_path = ''`, `(select auth.uid())`, RPC critique = squelette de
`docs/05-reference-technique.md` §1 + test de concurrence — est dans `.claude/rules/supabase.md`,
chargée automatiquement dès que le fichier `.sql` est ouvert. Ce skill ne la recopie pas : il la
fait appliquer, point par point, avant de considérer la migration terminée. Cas pas limpide → ne
pas trancher seul, signaler à Jérôme (`CLAUDE.md` §1.4).

## Procédure
1. Écrire la migration en appliquant la checklist ci-dessus.
2. Appliquer en local : `npx supabase db reset` (ou `npx supabase migration up` si incrémental).
3. Régénérer les types : `npx supabase gen types typescript --local 2>/dev/null | grep -v
   "^Connecting to db" > packages/supabase/src/database.types.ts` (depuis `hifago/`, racine du
   monorepo — un seul fichier de types partagé par les deux apps via `@hifago/supabase`, jamais
   dupliqué par app). **Le filtre `grep -v` est obligatoire, pas cosmétique** : la CLI écrit
   parfois `Connecting to db 5432` sur stdout (pas stderr) avant le vrai TypeScript — capturé tel
   quel par une simple redirection `>`, ça casse `tsc` avec une erreur de syntaxe sur la ligne 1,
   silencieusement jusqu'au prochain typecheck. Déjà reproduit deux fois (2026-08-14, 2026-08-15)
   avec la commande sans filtre — toujours utiliser la forme filtrée ci-dessus.
4. Si la migration crée/modifie une RPC exécutant une opération **critique au sens de
   `CLAUDE.md` §4.1** (réservation, fermeture de date/créneau, décrément de capacité — **pas**
   toute table RPC-only en général : une table d'audit-log ou une vue miroir RPC-only n'est pas
   concernée) : lancer `/hifago-test concurrence` avant de considérer la tâche terminée. En cas de
   doute, comparer à la liste des RPC déjà couvertes (`hifago/tests/concurrency/*.concurrency.mjs`)
   plutôt qu'à la seule propriété RPC-only de la table.

## Ce qui est normal, ne pas le signaler comme un problème
- Une table purement informative (contenu de fiche, profil) n'a pas de fonction `security definer`
  associée — normal, elle n'en a pas besoin.
- Deux migrations consécutives touchant la même table — normal en développement itératif, la seule
  règle est que chaque migration individuelle respecte la checklist.
