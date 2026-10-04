---
name: hifago-rpc-critique
description: Écrit une nouvelle RPC anti-survente pour le nouveau stack Hifago en reproduisant le squelette validé le 2026-08-12 (SECURITY DEFINER, SET search_path='', SELECT...FOR UPDATE) et génère son test de concurrence à barrière de synchronisation dans le même geste. Invocation Codex — $hifago-rpc-critique [nom_operation]
---

# /hifago-rpc-critique — nouvelle opération critique (anti-survente)

Distinct de `/hifago-migration` (portée générale) : ce skill est réservé aux opérations où une
survente est possible (réservation, fermeture de date/créneau, décrément de capacité) — l'enjeu est
de l'argent réel, pas une simple règle métier. **Une RPC critique n'est jamais livrée sans son test
de concurrence associé, dans le même geste.**

## Argument `$ARGUMENTS`
`<nom_operation>` : nom de la fonction RPC à créer (ex. `close_calendar_slot`,
`decrement_activity_capacity`).

## Procédure

1. **Identifier la ressource protégée** — quelle table porte le compteur de capacité/disponibilité
   concerné. Si elle n'existe pas encore, la créer via `/hifago-migration` d'abord (avec ses grants
   revoke — cf. `CLAUDE.md` § 3).

2. **Copier le squelette SQL de `docs/05-reference-technique.md` § 1** tel quel, en
   remplaçant uniquement les noms de table/paramètres — jamais réinventer la structure
   (`security definer`, `set search_path = ''`, `select ... for update` avant toute décision).

3. **Copier le squelette de test de `docs/05-reference-technique.md` § 2**, adapté à la
   nouvelle RPC — barrière de synchronisation (N connexions `pg` indépendantes, signal de "ready"
   partagé, relâche simultanée), jamais un `Promise.all` naïf.

4. **Lancer le test au moins 5 fois consécutives** avec un reset SQL léger entre chaque run (pas
   `supabase db reset`, trop lent en boucle — un simple `UPDATE`/`DELETE` de remise à zéro des
   lignes concernées suffit). Barre d'acceptation : succès exact et unique à chaque run, aucun
   échec toléré même isolé.

5. **Appeler la RPC depuis la Route Handler en un seul aller-retour** — jamais une lecture
   préalable côté app suivie d'une écriture séparée, même "pour vérifier avant".

6. **Comportement de panne** : si un service dont dépend l'appel est indisponible (ex. relais réseau
   LobbyPMS pour une réservation PMS-backed), la Route Handler bloque l'opération — échec fermé,
   jamais un contournement silencieux (cf. `CLAUDE.md` § 4).

## Ce qui rend une RPC critique "terminée"
- [ ] Squelette conforme (verrouillage explicite, un seul aller-retour, `security definer` +
      `search_path` fixé)
- [ ] Grants d'écriture directe révoqués sur la table protégée
- [ ] Test de concurrence écrit et vert sur ≥ 5 runs consécutifs
- [ ] Comportement d'échec fermé vérifié (panne simulée d'un service dépendant)

Si l'un de ces points manque, la tâche n'est pas terminée — ne pas la présenter comme telle.
