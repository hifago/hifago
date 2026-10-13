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

> **Le principe :** tout tourne directement sous Windows. **Docker Desktop** fait tourner la base
> de données, **Node.js** les deux apps, et **Git Bash** (installé avec Git) les quelques scripts
> du projet écrits en bash. Pas d'Ubuntu ni de WSL à installer ou à utiliser.

---

## A — Installer les outils (une seule fois)

### A1. Git pour Windows (fournit Git Bash)

Si Git est déjà installé sur le PC, passe à A2. Sinon, télécharge et installe
<https://git-scm.com/download/win> en gardant les options proposées.

✅ **Vérifier :** ouvre l'application **Git Bash** depuis le menu Démarrer, puis tape
`git --version` : un numéro de version s'affiche.

À partir d'ici, **toutes les commandes se tapent dans Git Bash** (l'application, ou le terminal de
VS Code une fois réglé en A5), sauf mention contraire.

### A2. Docker Desktop

1. Télécharge et installe Docker Desktop : <https://www.docker.com/products/docker-desktop/>.
   S'il demande d'installer ou de mettre à jour WSL, accepte : c'est son moteur interne, tu n'auras
   jamais à t'en servir. Redémarre le PC si on te le demande.
2. Lance Docker Desktop et attends que l'icône de baleine, dans la barre des tâches, cesse de
   s'animer.

✅ **Vérifier :** `docker run --rm hello-world` affiche « Hello from Docker! ».

### A3. Node.js 22

Télécharge et installe la version **22** de Node.js pour Windows depuis <https://nodejs.org>.
C'est la version qu'utilise la CI. Ferme puis rouvre Git Bash après l'installation.

✅ **Vérifier :** `node -v` affiche `v22.…`.

### A4. Client PostgreSQL (`psql`)

`npm run db:setup` (C2) en a besoin pour charger les données de démo.

1. Télécharge l'installeur Windows : <https://www.enterprisedb.com/downloads/postgres-postgresql-downloads>.
2. À l'écran **Select Components**, ne garde que **Command Line Tools** (décoche PostgreSQL
   Server, pgAdmin et Stack Builder).
3. Ajoute `psql` au chemin de Windows. Dans **PowerShell** (pas besoin du mode administrateur) :

   ```powershell
   $bin = (Resolve-Path 'C:\Program Files\PostgreSQL\*\bin' | Select-Object -Last 1).Path
   [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ";$bin", 'User')
   ```

4. Ferme toutes les fenêtres Git Bash et VS Code, puis rouvre-les.

✅ **Vérifier :** `psql --version` affiche un numéro de version.

### A5. VS Code et Claude Code

1. Installe VS Code : <https://code.visualstudio.com>.
2. Règle son terminal sur Git Bash : `Ctrl+Shift+P`, tape « Terminal: Select Default Profile »,
   puis choisis **Git Bash**.
3. Installe l'extension **Claude Code**. Sous Windows, Claude Code passe lui aussi par Git Bash
   pour lancer ses commandes : A1 suffit.

### A6. Faire lancer les scripts npm par Git Bash

```bash
npm config set script-shell 'C:\Program Files\Git\bin\bash.exe'
```

Sous Windows, npm lance par défaut ses scripts avec `cmd`, qui ne comprend pas ceux du projet : dès
`npm ci`, le script `prepare` échouerait. Si Git est installé ailleurs, `where.exe git` affiche
`…\Git\cmd\git.exe`, et le bon chemin est alors `…\Git\bin\bash.exe`.

✅ **Vérifier :** `npm config get script-shell` affiche `C:\Program Files\Git\bin\bash.exe`.

---

## B — Récupérer le projet (une seule fois)

### B1. Cloner

```bash
mkdir -p ~/dev && cd ~/dev
git clone -c core.autocrlf=false https://github.com/hifago/hifago.git
cd hifago
git switch staging
```

Le projet est alors dans `C:\Users\<toi>\dev\hifago`.

⚠️ **L'option `-c core.autocrlf=false` est indispensable.** Sans elle, Git pour Windows convertit
les fins de ligne, et les scripts bash du projet plantent (`$'\r': command not found`).

⚠️ **Évite un dossier synchronisé par OneDrive**, ce qui est souvent le cas de Documents et du
Bureau. La synchronisation de dizaines de milliers de fichiers ralentit tout et peut abîmer
`node_modules`.

`staging` est la branche de travail, la plus à jour. `main` est la prod.

**Tu as déjà le projet sur ce PC ?** Garde **une seule** copie, celle que tu ouvres dans VS Code.
Si une ancienne copie existe dans Ubuntu/WSL (ancienne version de ce guide), ne t'en sers plus. Pour
une copie Windows clonée sans l'option ci-dessus, demande à Claude d'appliquer la règle H.2 plutôt
que de recloner.

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

Tu peux aussi passer par **Fichier → Ouvrir le dossier** sur `C:\Users\<toi>\dev\hifago`.

✅ **Vérifier :** le terminal de VS Code (`Ctrl+ù`) affiche un en-tête `MINGW64 ~/dev/hifago` :
c'est bien Git Bash, dans le bon dossier. Tu peux y taper toutes les commandes suivantes.

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

| Quoi | Adresse (dans le navigateur) |
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

**Se connecter à l'admin par Google** (il faut les vrais identifiants Google dans `.env`, étape
B3) : un Gmail inconnu de la base locale est refusé, son compte doit exister avant. Crée-le avec
sa capacité admin, à refaire après chaque `npm run db:setup` :

```bash
npm run db:google-admin -- ton.adresse@gmail.com
```

À la première connexion Google, l'admin demande d'enrôler un 2FA (QR code à scanner avec une
application d'authentification).

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
2. Ouvre le projet dans VS Code (**Fichier → Ouvrir récent**), puis son terminal (`Ctrl+ù`).
3. Lance :

```bash
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
| `npm ci` échoue sur `prepare` avec « 'true' n'est pas reconnu… » (« 'true' is not recognized… ») ou « Le chemin d'accès spécifié est introuvable » | npm lance ses scripts avec `cmd` : refaire A6, puis relancer `npm ci` |
| `$'\r': command not found`, `pipefail\r` ou `bash\r: No such file or directory` | Fins de ligne Windows dans les scripts : demander à Claude d'appliquer la règle H.2 |
| `docker info` échoue (« error during connect », « cannot find the file specified ») | Docker Desktop n'est pas lancé : le lancer et attendre que la baleine cesse de s'animer |
| `supabase start` : « Missing required field … auth.external.google.client_id » | Le fichier `.env` racine manque ou a des valeurs Google vides : refaire B3 |
| `supabase start` : « Ports are not available … 5432x … forbidden by its access permissions » | Windows réserve parfois cette plage de ports. Dans PowerShell **administrateur** : `net stop winnat`, puis `net start winnat`, puis relancer `npx supabase start` |
| `supabase start` : un conteneur est « unhealthy » ou ne démarre pas | `npx supabase stop`, puis `npx supabase start`. Si le problème persiste, redémarrer Docker Desktop |
| `npm run db:setup` : « psql introuvable » | Refaire A4, puis fermer et rouvrir VS Code |
| Port 3100 ou 3101 déjà utilisé | Une ancienne instance tourne encore. `netstat -ano \| grep ':3100 '` : le dernier nombre de la ligne `LISTENING` est son PID. Puis `taskkill //F //PID <pid>` (la double barre est obligatoire dans Git Bash) |
| Tout est très lent (`npm ci`, démarrage, rechargement) | L'antivirus de Windows analyse chaque fichier de `node_modules` : Sécurité Windows → Protection contre les virus et menaces → Gérer les paramètres → Exclusions → ajouter le dossier du projet. Vérifier aussi qu'il n'est pas dans OneDrive (B1) |
| PC qui rame, ou erreur de mémoire | Fermer d'autres applications. Si le PC a 8 Go de RAM, c'est juste : créer `C:\Users\<toi>\.wslconfig` avec `[wsl2]` puis `memory=6GB` sur la ligne suivante (c'est là que Docker Desktop lit sa limite de mémoire), puis redémarrer le PC |
| Connexion qui boucle ou déconnexion après redirection | Utiliser `localhost` partout (pas `127.0.0.1`) pour les apps |
| La page reste vide ou affiche une erreur Supabase | Supabase est arrêté : `npx supabase status`. Si besoin, `npx supabase start` |

---

## H — Règles pour l'IA (Claude Code)

Les règles du projet sont dans `CLAUDE.md`, que tu lis de toute façon. Celles-ci y ajoutent ce qui
est propre à une machine Windows :

1. **Pas de WSL.** Le projet tourne directement sous Windows, dans la copie ouverte dans VS Code,
   et c'est la seule. Tes commandes passent par Git Bash : syntaxe bash, jamais cmd ni PowerShell.
   N'utilise jamais `wsl …` ni un chemin `\\wsl$\…`, même si une ancienne copie du projet existe
   dans WSL : n'y écris rien et n'y lance rien. Seules exceptions, données comme consignes pour
   Jérôme et jamais à lancer toi-même : `net stop/start winnat` (PowerShell administrateur) et la
   commande d'ajout au Path de A4 (PowerShell).
2. **Fins de ligne : à vérifier avant le premier script bash.** `git config core.autocrlf` doit
   afficher `false`, et `git ls-files --eol scripts/db-setup.sh` doit contenir `w/lf`. Sinon :
   - si `git status --porcelain` est vide, lance
     `git config core.autocrlf false && git rm -rq --cached . && git reset -q --hard` ;
   - sinon, demande d'abord à Jérôme de commiter son travail en cours, car cette commande réécrit
     tous les fichiers suivis.
3. **npm doit lancer ses scripts avec Git Bash :** `npm config get script-shell` doit pointer vers
   `…\Git\bin\bash.exe`. Sinon, applique A6.
4. **Les skills du projet sont valables telles quelles** (`/hifago-dev`, `/hifago-seed`,
   `/hifago-mock-data`, `/hifago-test`), car tout y est écrit en bash. Deux transpositions :
   `brew install libpq` devient l'étape A4 ; une option Windows qui commence par `/` se double dans
   Git Bash (`taskkill //F //PID 1234`), sinon Git Bash la transforme en chemin.
5. **Local uniquement** (`CLAUDE.md` §8). Aucune commande contre un projet Supabase ou Vercel
   cloud sans une confirmation explicite de Jérôme à chaque fois. Ce guide n'en contient aucune.
6. **`npm run db:setup` efface la base locale.** Préviens Jérôme et obtiens son accord avant de le
   lancer : il peut avoir des données de test en cours.
7. **Quand Jérôme dit « lance le projet »**, applique dans l'ordre :
   1. lance `docker info`. En cas d'échec, demande-lui de démarrer Docker Desktop et arrête-toi là ;
   2. lance `npx supabase start` ;
   3. vérifie que la base est remplie :
      `psql "$(npx supabase status -o env | grep '^DB_URL=' | cut -d'"' -f2)" -Atc "select count(*) from establishments"`.
      Si le résultat vaut `0`, lance C2 puis C3, après accord (règle 6) ;
   4. si `apps/web/.env.local` ou `apps/admin/.env.local` manque, lance le bloc C4 ;
   5. lance `npm run dev` en arrière-plan, attends les deux « Ready », puis donne les adresses de
      la partie D.
8. Si un symptôme figure dans le tableau G, applique la solution indiquée avant de chercher
   ailleurs.
9. N'écris jamais de secret cloud dans un `.env`, un `.env.local` ou un fichier du dépôt
   (`CLAUDE.md` §8.2). Les clés de Supabase local de C4 n'en sont pas.
