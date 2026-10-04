---
name: hifago-verify-compte
description: Vérifie explicitement à quel compte ou organisation cloud (Supabase, Vercel) un token ou une session MCP est rattaché avant toute action non locale sur le projet Hifago, et bloque en cas de doute. Invocation Codex — $hifago-verify-compte
---

# /hifago-verify-compte — vérification de compte avant action cloud

> Garde-fou manuel explicite, né d'un incident réel : le 2026-08-12, le serveur MCP Supabase
> connecté à la session pointait sur des organisations "Fofly"/"Fofly-v2" — un compte totalement
> différent de celui du projet Hifago (gabriel.34.miro@gmail.com). Détecté avant toute action grâce
> à cette vérification systématique. **Ce skill ne remplace pas** `CLAUDE.md` § 8 (règle
> toujours active) — c'est le geste manuel qui l'applique concrètement.

## Quand l'invoquer
Avant TOUTE action touchant une ressource cloud réelle pour ce projet : création/modification d'un
projet Supabase, déploiement Vercel, ou tout appel d'outil MCP dont le nom commence par
`mcp__supabase__` ou `mcp__vercel__`. Ne jamais supposer que l'outil connecté est le bon compte —
le vérifier à chaque fois, pas une fois pour toutes.

## Procédure

1. **Supabase** : appeler `mcp__supabase__list_organizations` (ou équivalent). Comparer le nom
   des organisations retournées avec ce qui est attendu pour Hifago — si aucune ne correspond
   clairement au projet (nom d'organisation reconnaissable, pas un nom générique ou inconnu),
   **s'arrêter et signaler à Jérôme** plutôt que de continuer en espérant que ça s'arrange.

2. **Vercel** (si applicable) : vérifier l'équipe/le compte actif via l'outil ou la CLI disponible
   avant tout déploiement — même logique, même exigence de correspondance explicite.

3. **Si un doute subsiste** (nom ambigu, plusieurs organisations possibles, token d'origine
   inconnue) : ne jamais trancher par supposition. Demander confirmation explicite à Jérôme, avec
   le détail exact de ce qui a été trouvé (noms d'organisations, IDs) — pas juste "c'est bon".

4. **Si tout correspond** : documenter brièvement dans la réponse à Jérôme quel compte a été
   vérifié, avant de poursuivre l'action cloud demandée.

## Ce que ce skill NE fait PAS
- Ne crée, ne modifie, ni ne supprime aucune ressource — vérification pure.
- Ne remplace pas la prudence générale sur les secrets (cf. `CLAUDE.md` § 8, point 2 : un
  token collé dans une conversation reste un token à révoquer après usage, indépendamment du
  résultat de cette vérification).
