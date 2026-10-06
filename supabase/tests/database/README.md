# Tests pgTAP — `supabase/tests/database/`

Une centaine de fichiers `*.test.sql` (94 au 2026-10-06). La plupart couvrent un domaine précis :
policies RLS, contraintes, logique séquentielle d'une RPC, journal d'audit, cycle de vie des
propositions et des commandes, disponibilité, réconciliation.

Quelques-uns sont des **gardes structurelles** : ils interrogent le catalogue système et vérifient un
invariant sur TOUT le schéma, sans mise à jour à l'ajout d'une table ou d'une fonction conforme. Voir
l'en-tête de chacun :

- `rls_rpc_only_checklist` — RLS activée partout, fonctions de policy jamais VOLATILE, `auth.uid()`
  toujours sous un `( SELECT … )`, `search_path=''` partout, pas de grant d'écriture sans policy ;
- `security_definer_exposure` — toute RPC SECURITY DEFINER exposée porte un garde interne (cherché
  dans la source sans ses commentaires), ou figure nommément dans une liste justifiée ;
- `service_role_only_functions` — les fonctions protégées par leur seul grant, vérifiées dans les
  deux sens ;
- `cron_jobs` — la liste exacte des jobs pg_cron actifs (nom, cadence, commande) ;
- `capacity_check_constraints` — les CHECK de capacité, quantité, montants et bornes, à l'identique.

**Jamais utilisés pour la concurrence** (`create_order`, réservation) : chaque fichier tourne dans une
transaction annulée, structurellement incapable de simuler une vraie concurrence — `hifago/CLAUDE.md`
§6 point 3. La suite dédiée (`tests/concurrency/*.concurrency.mjs`, barrière de synchronisation)
reste le seul outil valide pour ça.

## Lancer localement

```
npm run test:db
```

(depuis `hifago/`, alias de `supabase test db`). Nécessite la stack Supabase locale — jamais un
projet cloud partagé. Pendant le développement, seulement les fichiers touchés : `/hifago-test
<fichier(s)>` (`hifago/CLAUDE.md` §6 point 5).

## En CI : deux passages, deux bases

- job `db` : base **vierge** (migrations seules, aucun seed) ;
- fin du job `concurrence` : base **seedée** par `npm run db:setup` puis écrite par les tests de
  concurrence (audit P12b, 2026-10-06).

Un fichier doit être vert sur les deux. D'où la règle :

## Règle : scoper, jamais compter en absolu

Un compte porte sur les lignes des fixtures du fichier (`where entity_id = …`, `where product_id = …`,
un jeton propre au fichier dans un champ texte), jamais sur la table entière : `select count(*) from
audit_log` vaut 0 sur une base vierge et n'importe quoi ailleurs. Sept fichiers comptaient ainsi
jusqu'au 2026-10-06 — verts en CI, rouges sur toute base réelle, pris pour de la « pollution ».

- Seule exception admise : une assertion qui vaut **zéro quelle que soit la base** (« un non-admin
  ne voit aucune ligne »).
- Une fonction à lot global (`p_batch_size`) : passer une taille qui couvre toutes les cibles du
  fichier, jamais le lot par défaut.
- Un tri : lire l'ordre via `with ordinality`, pas l'ordre d'arrivée d'`array_agg`.
- Les colonnes d'un `returns table` : liste EXACTE lue dans `proargnames`/`proargmodes` (mode `'t'`),
  jamais via `pg_type.typrelid`, nul pour un `record` — une jointure sur `pg_attribute` n'y trouve
  rien et l'assertion passe quoi que la fonction rende (corrigé dans six fichiers le 2026-10-06).

Une règle ainsi réécrite se prouve par **mutation** : casser la fonction testée dans une transaction
annulée et vérifier que l'assertion rougit (CLAUDE.md §11.20).
