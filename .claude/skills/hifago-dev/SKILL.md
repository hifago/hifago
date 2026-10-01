---
name: hifago-dev
description: Démarre/arrête l'environnement de dev quotidien du nouveau stack Hifago — Supabase local (Docker) + les deux apps Next.js du monorepo (web/admin) — gère port occupé et Docker non démarré. Usage — /hifago-dev (les deux), /hifago-dev web, /hifago-dev admin (ou /hifago-dev stop, /hifago-dev status)
---

# /hifago-dev — environnement de dev quotidien

Équivalent hifago de `/preview` (app actuelle) — mais toujours **local**, jamais contre un projet
Supabase cloud (cf. `CLAUDE.md` § 8). Monorepo à deux apps depuis le 2026-08-14 :
`apps/web` (port 3100) et `apps/admin` (port 3101), packages partagés sous `packages/*`.

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| *(vide)* | Démarre Supabase local + les deux apps (`npm run dev` racine, via `concurrently`), ouvre le navigateur sur `apps/web` |
| `web` | Démarre Supabase local + `apps/web` seule (`npm run dev:web`), port 3100 |
| `admin` | Démarre Supabase local + `apps/admin` seule (`npm run dev:admin`), port 3101 |
| `stop` | Arrête les serveurs Next.js et la stack Supabase locale (`supabase stop`) |
| `status` | Affiche l'état (Docker up/down, ports 3100/3101 occupés ou libres) |

## Pièges connus
- **Machine Windows** : tout tourne dans WSL 2 (bash Ubuntu, clone sous `~`, jamais `/mnt/c`) avec
  Docker Desktop — installation, base de démo, comptes et dépannage propres à Windows dans
  `DEMARRAGE-LOCAL-WINDOWS.md` (partie H pour l'IA).
- **Docker non démarré** : `supabase start` échoue avec une erreur peu claire côté Docker — lancer
  Docker Desktop d'abord, ne pas re-diagnostiquer ce symptôme à chaque fois.
- **Port 3100 ou 3101 déjà occupé** : un serveur Next.js précédent tourne encore (crash sans
  cleanup) — identifier le process sur le port avant d'en lancer un nouveau, plutôt que de changer
  de port en boucle.
- **Premier `supabase start`** : télécharge les images Docker (peut prendre plusieurs minutes) ; les
  démarrages suivants sont rapides. Ne pas interpréter une lenteur au premier lancement comme un
  bug.

## Procédure (mode par défaut)
1. Vérifier Docker (`docker info`) — si en échec, arrêter et le signaler clairement plutôt que de
   laisser `supabase start` échouer avec un message opaque.
2. `npx supabase start` depuis `hifago/` (racine du monorepo — `supabase/` n'est pas dupliqué par
   app) — affiche l'URL locale, les clés (déjà des valeurs par défaut de dev publiques, jamais de
   vrai secret).
3. `npm run dev` (les deux, port 3100 + 3101) ou `npm run dev:web`/`npm run dev:admin` (un seul)
   depuis `hifago/` — chaque app lit son propre `.env.local` (mêmes valeurs Supabase, dupliquées
   par nécessité, cf. `CLAUDE.md` § 2).
4. Ouvrir le navigateur sur l'URL locale demandée.

## Ce que ce skill NE fait PAS
Pas de migration ni de seed (délégués à `/hifago-migration` et `/hifago-seed`) — `/hifago-dev`
suppose une base déjà à jour.
