# Relais LobbyPMS (Vultr)

LobbyPMS n'accepte que des IP déclarées, par utilisateur Lobby. Or ni Vercel ni les Edge
Functions Supabase n'ont d'IP sortante fixe. Un petit reverse-proxy Caddy, sur une IP réservée,
fait donc l'intermédiaire. Il laisse passer vers `api.lobbypms.com` toute requête qui porte le bon
en-tête `X-Relay-Secret`, et répond 403 à tout le reste. Il y a **un relais par environnement**
(préprod, prod), tous deux construits à partir du même `cloud-init.yaml`.

Choix déjà tranchés, à ne pas rouvrir (CLAUDE.md §2.5 et §9) : jamais Fly. Vultr est retenu, en
région Miami, un nœud de connectivité majeur pour l'Amérique latine (choix du 2026-08-23).

## Créer un relais

1. **Clé SSH** : ajouter `~/.ssh/hifago_relay_ed25519.pub` dans Vultr → Account → SSH Keys. Il
   n'y a jamais d'accès SSH par mot de passe.
2. **Instance** : Deploy → Cloud Compute (Shared CPU), avec les réglages suivants :
   - Location : Miami
   - Image : Ubuntu LTS (26.04 au 2026-09-30)
   - Plan : `vc2-1c-1gb`
   - Auto Backups : désactivé (tout est reconstructible depuis ce dossier)
   - SSH Key : celle de l'étape 1
   - Hostname : `hifago-relay-<env>`
   - Cloud-Init User-Data : le contenu **intégral** de `cloud-init.yaml`
3. **IP réservée** : Network → Reserved IPs → convertir l'IP principale de l'instance. L'IP ne
   change pas, et elle survivra à une reconstruction de l'instance. C'est cette IP que Lobby
   autorise. Le nom d'hôte `<ip-avec-tirets>.nip.io`, calculé au premier boot, reste donc valable.
4. **Pare-feu Vultr** (en plus d'`ufw` sur la machine) :
   - port 22 limité à l'IP de la personne qui administre ;
   - port 443 ouvert à tous.
5. **Vérifier**, 3 à 5 minutes après le démarrage :
   - `ssh -i ~/.ssh/hifago_relay_ed25519 root@<ip> cloud-init status --long` → `status: done`,
     sans erreur ;
   - `curl https://<ip-avec-tirets>.nip.io/healthz` → `ok` ;
   - la même URL sur un autre chemin, sans en-tête → `forbidden` (403).
6. **Récupérer les deux valeurs tirées sur la machine.** Cette étape se fait dans son propre
   terminal, jamais par un agent. Les copier dans le gestionnaire de mots de passe :
   - le secret du relais :
     `ssh … root@<ip> "grep ^RELAY_SECRET= /etc/caddy/relay.env | cut -d= -f2"` ;
   - le topic d'alerte : `ssh … root@<ip> "cut -d= -f2 /etc/relay/healthcheck.env"`. S'y
     abonner dans l'app ntfy.
7. **Brancher le relais** :
   - `LOBBY_API_BASE_URL=https://<ip-avec-tirets>.nip.io` et `LOBBY_RELAY_SECRET` dans les secrets
     Edge Functions du projet Supabase de l'environnement ;
   - les mêmes variables dans le projet Vercel, sur la cible de l'environnement ;
   - dans LobbyPMS, ajouter l'IP à la liste de l'utilisateur Lobby utilisé. Le jeton et la liste
     d'IP vont par utilisateur ;
   - dans UptimeRobot, créer un moniteur HTTPS sur `/healthz`.

## Exploiter

- Pour relancer : `systemctl restart caddy`, **jamais `reload`**. systemd ne relit
  l'`EnvironmentFile` qu'au démarrage.
- Pour changer le secret : réécrire `RELAY_SECRET` dans `/etc/caddy/relay.env`, puis
  `systemctl restart caddy`. Mettre ensuite à jour Supabase et Vercel, puis redéployer Vercel.
- Pour modifier la configuration : modifier `cloud-init.yaml` ici d'abord, puis reporter la
  modification à la main sur les instances. Le fichier doit rester la seule source de vérité.
- Journal d'accès : `/var/log/caddy/relay-access.log`.

## Pièges déjà rencontrés (docs/journal/2026-08.md, 2026-09.md)

Chacun est désormais neutralisé dans `cloud-init.yaml`, où un commentaire explique la parade.

1. Un en-tête `#cloud-init` au lieu de `#cloud-config` fait ignorer tout le fichier.
2. Vultr pose un `50-cloud-init.conf` avec `PasswordAuthentication yes`, et sshd garde la
   première valeur lue. Le durcissement doit donc trier avant (`00-`).
3. Le paquet caddy ne redémarre pas après un crash, faute de `Restart=` dans son unit.
4. Si le fichier de log est pré-créé par root, le service caddy ne peut plus y écrire.
5. Un healthcheck en HTTP reçoit le 308 de Caddy, que `curl -f` prend pour un succès.
6. Lobby prend `X-Forwarded-Host` pour l'hôte réel : il faut retirer cet en-tête (2026-09-19).
