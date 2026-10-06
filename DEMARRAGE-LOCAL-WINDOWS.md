# Lancer hifago en local sur un PC Windows — de A à Z

Ce guide sert à deux lecteurs : **Jérôme**, qui suit les étapes, et **l'IA (Claude Code)** qui
l'aide. Les règles propres à l'IA sont dans la [partie H](#h--règles-pour-lia-claude-code).

**À la fin, tu as :**
- la vitrine sur <http://localhost:3100> et l'admin/socio sur <http://localhost:3101> ;
- une base de démo complète (établissements, activités, chambres, événements, transports,
  partenaires, commandes, photos) ;
- des comptes de test prêts à l'emploi ;
- des paiements **simulés** (aucun vrai Mercado Pago, aucune carte).

Tout tourne sur ta machine. Aucune ressource cloud (Supabase, Vercel) n'est touchée.

**Durée :** compter environ 1 h la première fois, surtout du téléchargement. Ensuite, le
démarrage prend environ 1 minute.

> **Le principe :** le projet est entièrement outillé en bash (scripts, hooks git, CLI Supabase).
> Sous Windows, on le fait donc tourner dans **WSL 2** (un vrai Ubuntu intégré à Windows), avec
> **Docker Desktop** pour la base de données. Le navigateur et VS Code restent côté Windows.
> On ne lance jamais une commande du projet dans PowerShell ni dans cmd.

---

## A — Installer les outils (une seule fois)

### A1. WSL 2 + Ubuntu

Ouvre **PowerShell en administrateur** (clic droit sur le menu Démarrer → « Terminal
(administrateur) »), puis lance :

```powershell
wsl --install
```

Redémarre le PC. Ouvre ensuite l'application **Ubuntu** depuis le menu Démarrer : elle te demande
de choisir un nom d'utilisateur et un mot de passe Linux (garde ce mot de passe, `sudo` le
demandera).

✅ **Vérifier :** dans le terminal Ubuntu, `lsb_release -d` affiche « Ubuntu … ».

À partir d'ici, **toutes les commandes se tapent dans le terminal Ubuntu**, sauf mention contraire.

### A2. Docker Desktop

1. Télécharge et installe Docker Desktop : <https://www.docker.com/products/docker-desktop/>.
   Garde l'option « Use WSL 2 instead of Hyper-V » cochée.
2. Lance Docker Desktop, puis ouvre **Settings → Resources → WSL integration** et active le
   curseur **Ubuntu**. Termine par **Apply & restart**.

✅ **Vérifier :** dans Ubuntu, `docker run --rm hello-world` affiche « Hello from Docker! ».

### A3. Outils Linux (git, client PostgreSQL)

```bash
sudo apt update && sudo apt install -y git curl postgresql-client
```

✅ **Vérifier :** `psql --version` affiche un numéro de version.

### A4. Node.js 22 (via nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

**Ferme puis rouvre** le terminal Ubuntu, puis :

```bash
nvm install 22
```

✅ **Vérifier :** `node -v` affiche `v22.…`.

### A5. VS Code et Claude Code

1. Installe VS Code **côté Windows** (<https://code.visualstudio.com>), puis l'extension
   **WSL** (éditeur Microsoft).
2. Claude Code doit tourner **dans WSL**, pas dans Windows : dans une fenêtre VS Code connectée à
   WSL (voir B4), installe l'extension Claude Code. VS Code propose alors « Install in WSL:
   Ubuntu » : accepte. Pour la version terminal, lance dans Ubuntu :
   `curl -fsSL https://claude.ai/install.sh | bash`.

---

## B — Récupérer le projet (une seule fois)

### B1. Cloner dans le dossier personnel Linux

```bash
cd ~
git clone https://github.com/hifago/hifago.git
cd hifago
git switch staging
```

⚠️ **Clone toujours sous `~` (le disque Linux), jamais dans `C:\…` ni `/mnt/c/…`.** Sur le disque
Windows, le projet est très lent, le rechargement à chaud ne détecte plus les modifications, et les
fins de ligne Windows cassent les scripts bash.

`staging` est la branche de travail, la plus à jour. `main` est la prod.

### B2. Installer les dépendances

```bash
npm ci
```

✅ **Vérifier :** la commande se termine sans `npm ERR!`. Des `npm warn` sont normaux.

### B3. Créer le fichier `.env` racine (lu par Supabase local)

```bash
cp .env.example .env
sed -i 's|^SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=$|SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=local-dummy.apps.googleusercontent.com|; s|^SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=$|SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=local-dummy|' .env
```

Pourquoi les valeurs `local-dummy` : la connexion Google est activée dans
`supabase/config.toml`, et Supabase refuse de démarrer si ses identifiants sont vides (la CI fait
la même chose). Avec ces valeurs, tout fonctionne sauf le bouton « Continuer avec Google ». Pour
tester Google en local, demande les vrais identifiants à Gabriel par un canal privé, jamais dans un
chat ni dans un commit, et remplace ces deux lignes.

### B4. Ouvrir le projet dans VS Code

```bash
code .
```

VS Code s'ouvre côté Windows, connecté à WSL (« WSL: Ubuntu » en bas à gauche). Le terminal
intégré de VS Code est alors un terminal Ubuntu : tu peux y taper toutes les commandes suivantes.

---

## C — Démarrer la base et la remplir

À faire la première fois. À refaire chaque fois que tu veux repartir d'une base propre.

### C1. Démarrer Supabase local

Docker Desktop doit être lancé (icône de baleine dans la barre des tâches). Ensuite :

```bash
npx supabase start
```

La première fois, la commande télécharge plusieurs Go d'images Docker et peut prendre 5 à
15 minutes : ce n'est pas un plantage. Les fois suivantes, elle prend quelques secondes.

✅ **Vérifier :** la commande affiche un tableau d'URL (API `http://127.0.0.1:54321`, Studio
`http://127.0.0.1:54323`…).

### C2. Construire la base de démo

```bash
npm run db:setup
```

Ce script enchaîne, dans un ordre qui compte : les migrations, les comptes de test, les données
de `supabase/seed.sql`, puis les photos.

⚠️ **Cette commande EFFACE la base locale** avant de la reconstruire.

✅ **Vérifier :** la dernière ligne affichée est `==> base locale prête`. Un avertissement du
type « psql major version … server major version … » est normal.

### C3. Ajouter le catalogue de démonstration (`mockData/`)

Cette étape ajoute 16 établissements, 35 activités, des chambres, des événements, des transports
et 10 partenaires avec leurs photos.

```bash
eval "$(npx supabase status -o env | grep -E '^[A-Z0-9_]+=' | sed 's/^/export /')"
SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  SUPABASE_ADMIN_EMAIL='admin@hifago.test' SUPABASE_ADMIN_PASSWORD='Seed1234!' \
  npm run db:mock-data
```

✅ **Vérifier :** le script affiche un résumé « N créé(s), N ignoré(s) » par type, sans erreur.
Tu peux le relancer sans risque : il n'ajoute que ce qui manque.

### C4. Créer les `.env.local` des deux apps

Cette étape est à faire une seule fois, car les clés locales ne changent pas d'un démarrage à
l'autre.

```bash
eval "$(npx supabase status -o env | grep -E '^[A-Z0-9_]+=' | sed 's/^/export /')"
cat > apps/web/.env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
NEXT_PUBLIC_WEB_APP_URL=http://localhost:3100
MERCADOPAGO_MOCK_MODE=true
EOF
cat > apps/admin/.env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
NEXT_PUBLIC_WEB_APP_URL=http://localhost:3100
EOF
```

Ces clés sont les clés de démo publiques de Supabase local, identiques sur toutes les machines :
ce ne sont pas des secrets. N'y mets **jamais** une clé d'un projet cloud (préprod, prod).

---

## D — Lancer les apps

```bash
npm run dev
```

✅ **Vérifier :** deux lignes « Ready » apparaissent, une préfixée `[web]` et une préfixée
`[admin]`.

| Quoi | Adresse (dans le navigateur Windows) |
|---|---|
| Vitrine publique | <http://localhost:3100> |
| Admin + espace socio | <http://localhost:3101> |
| Supabase Studio (voir/éditer les tables) | <http://127.0.0.1:54323> |
| Boîte mail locale (emails d'inscription, de mot de passe) | <http://127.0.0.1:54324> |

Utilise toujours `localhost` pour les deux apps, sans mélanger avec `127.0.0.1` : sinon, les
redirections de connexion peuvent te déconnecter.

---

## E — Se connecter et tester

### Comptes de test (base locale uniquement)

| Profil | Email | Mot de passe | App |
|---|---|---|---|
| **Admin** | `admin@hifago.test` | `Seed1234!` | 3101 |
| Socio apporteur (référent) actif | `referent.actif@hifago.test` | `Seed1234!` | 3101 |
| Socio opérateur actif (sans établissement rattaché, c'est voulu) | `operateur.actif@hifago.test` | `Seed1234!` | 3101 |
| Socio suspendu | `referent.suspendu@hifago.test` | `Seed1234!` | 3101 |
| Opérateur avec propositions de produits | `operador.propuestas@hifago.test` | `Seed1234!` | 3101 |
| Socios du catalogue de démo (apporteur et/ou opérateur) | `user1@hifago.co` … `user5@hifago.co` | `User_1234` … `User_5234` (`User_` + numéro + `234`) ; base locale créée avant le 2026-10-06 : `User_1` … `User_5` | 3101 |

Sur la vitrine, la réservation se fait sans compte. Pour tester l'inscription client, crée un
compte depuis la vitrine : l'email de confirmation arrive dans la boîte mail locale (port 54324).

Si un écran de code 2FA apparaît pour l'admin (cas rare), génère le code du moment avec :

```bash
node --experimental-strip-types --no-warnings -e "import('./packages/e2e-support/src/mfa.ts').then(m=>console.log(m.generateTotp(m.ADMIN_TOTP_SECRET)))"
```

### Parcours conseillé

1. **Vitrine** (3100) : parcourir les catégories, ouvrir une fiche d'établissement ou d'activité.
2. **Réserver** : ajouter une offre au voyage (activité, événement ou chambre, **sauf**
   « Alojamiento PMS-backed (demo) », voir plus bas), aller jusqu'au paiement. Une page de
   **simulateur** remplace Mercado Pago (bandeau « SIMULADOR DE PAGO ») : clique sur « Pagar
   (simulado) » ou sur « Rechazar (simulado) ».
3. **Admin** (3101, `admin@hifago.test`) : retrouver la commande dans **Pedidos**, puis
   regarder **Partners**, **Establecimientos** et **Catálogo**.
4. **Socio** (3101, `user1@hifago.co`) : voir l'espace partenaire tel qu'un socio le voit.

### Ce qui ne marche pas en local (et c'est normal)

| Fonction | Pourquoi |
|---|---|
| Connexion Google | Identifiants factices (voir B3) |
| Emails transactionnels (confirmation de réservation…) | Envoyés par Resend, non configuré en local. Seuls les emails d'authentification arrivent, dans la boîte mail locale |
| Vrai paiement Mercado Pago | Remplacé par le simulateur (`MERCADOPAGO_MOCK_MODE=true`) |
| Synchronisation LobbyPMS | Exige le relais réseau de la préprod |
| Payer une nuit de « Alojamiento PMS-backed (demo) » (Casa Kayam Guatapé) | Blocage voulu : une nuit liée à LobbyPMS doit être réservée chez Lobby avant le paiement, et en local Lobby est injoignable (jeton factice). La réservation est bloquée plutôt que de risquer une survente : ce n'est pas un bug |
| Autocomplétion d'adresse Google Maps (admin) | Clé optionnelle absente : le champ reste manuel |

---

## F — Au quotidien

**Démarrer**, dans cet ordre :
1. Lance Docker Desktop.
2. Ouvre le terminal Ubuntu (ou VS Code via `code ~/hifago`).
3. Lance :

```bash
cd ~/hifago
npx supabase start
npm run dev
```

**Arrêter :** `Ctrl+C` dans le terminal des apps, puis `npx supabase stop`. La base est
conservée et tu la retrouves au prochain `supabase start`.

**Récupérer la dernière version :**

```bash
git pull
npm ci
npm run db:setup      # ⚠️ efface la base locale, puis la reconstruit avec les nouvelles migrations
```

Relance ensuite le bloc C3 (catalogue de démo). Les `.env.local` (C4) n'ont pas besoin d'être
refaits.

---

## G — Dépannage

| Symptôme | Solution |
|---|---|
| `docker: command not found` dans Ubuntu | Docker Desktop n'est pas lancé, ou l'intégration WSL n'est pas activée (A2) |
| `supabase start` : « Missing required field … auth.external.google.client_id » | Le fichier `.env` racine manque ou a des valeurs Google vides : refaire B3 |
| `supabase start` : « Ports are not available … 5432x … forbidden by its access permissions » | Windows réserve parfois cette plage de ports. Dans PowerShell **administrateur** : `net stop winnat`, puis `net start winnat`, puis relancer `npx supabase start` |
| `supabase start` : un conteneur est « unhealthy » ou ne démarre pas | `npx supabase stop`, puis `npx supabase start`. Si le problème persiste, redémarrer Docker Desktop |
| `npm run db:setup` : « psql introuvable » | Refaire A3 |
| `bash\r: No such file or directory` ou `$'\r': command not found` | Le dépôt a été cloné depuis Windows : le supprimer et recloner dans Ubuntu sous `~` (B1) |
| Le site ne se met pas à jour quand on modifie un fichier, ou il est très lent | Le projet est sous `/mnt/c/…` : recloner sous `~` (B1) |
| Port 3100 ou 3101 déjà utilisé | Une ancienne instance tourne encore. `ss -ltnp \| grep 3100` affiche son `pid=…`, puis `kill <pid>` |
| PC qui rame, ou erreur de mémoire | Fermer d'autres applications. Si le PC a 8 Go de RAM, c'est juste : créer `C:\Users\<toi>\.wslconfig` avec `[wsl2]` puis `memory=6GB` sur la ligne suivante, puis lancer `wsl --shutdown` dans PowerShell |
| Connexion qui boucle ou déconnexion après redirection | Utiliser `localhost` partout (pas `127.0.0.1`) pour les apps |
| La page reste vide ou affiche une erreur Supabase | Supabase est arrêté : `npx supabase status`. Si besoin, `npx supabase start` |

---

## H — Règles pour l'IA (Claude Code)

Les règles du projet sont dans `CLAUDE.md`, que tu lis de toute façon. Celles-ci y ajoutent ce qui
est propre à une machine Windows :

1. **Toutes les commandes s'exécutent dans le bash de WSL (Ubuntu)**, à la racine du clone sous
   `~/hifago`. Jamais PowerShell, jamais cmd, jamais un chemin `/mnt/c/…`. Seules exceptions,
   données ici comme consignes pour Jérôme et jamais à lancer toi-même : `wsl --install`,
   `net stop/start winnat` et `wsl --shutdown`, qui se tapent dans PowerShell administrateur.
2. **Les skills du projet sont valables telles quelles sous WSL** (`/hifago-dev`, `/hifago-seed`,
   `/hifago-mock-data`, `/hifago-test`), car tout y est écrit en bash. Seules les commandes
   d'installation écrites pour macOS se transposent : `brew install libpq` devient
   `sudo apt install postgresql-client`.
3. **Local uniquement** (`CLAUDE.md` §8). Aucune commande contre un projet Supabase ou Vercel
   cloud sans une confirmation explicite de Jérôme à chaque fois. Ce guide n'en contient aucune.
4. **`npm run db:setup` efface la base locale.** Préviens Jérôme et obtiens son accord avant de le
   lancer : il peut avoir des données de test en cours.
5. **Quand Jérôme dit « lance le projet »**, applique dans l'ordre :
   1. lance `docker info`. En cas d'échec, demande-lui de démarrer Docker Desktop et arrête-toi là ;
   2. lance `npx supabase start` ;
   3. vérifie que la base est remplie :
      `psql "$(npx supabase status -o env | grep '^DB_URL=' | cut -d'"' -f2)" -Atc "select count(*) from establishments"`.
      Si le résultat vaut `0`, lance C2 puis C3, après accord (règle 4) ;
   4. si `apps/web/.env.local` ou `apps/admin/.env.local` manque, lance le bloc C4 ;
   5. lance `npm run dev` en arrière-plan, attends les deux « Ready », puis donne les adresses de
      la partie D.
6. Si un symptôme figure dans le tableau G, applique la solution indiquée avant de chercher
   ailleurs.
7. N'écris jamais de secret cloud dans un `.env`, un `.env.local` ou un fichier du dépôt
   (`CLAUDE.md` §8.2). Les clés de Supabase local de C4 n'en sont pas.
