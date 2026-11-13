---
id: specs-synchro-agenda-google-apple
titre: "Synchronisation de l'agenda partenaire avec Google Agenda et Apple iCloud (deux sens)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: brouillon
maj: 2026-11-13
resume: >
  Le partenaire connecte son agenda Google (OAuth) ou Apple iCloud (CalDAV, mot de passe
  d'application) depuis son portail : chaque réservation Hifago y est écrite dans un agenda
  « Hifago » dédié, et chaque créneau occupé de ses propres agendas ferme les créneaux Hifago des
  produits qu'il y a liés — sans jamais interroger Google/Apple pendant une réservation.
mots_cles: [agenda, google calendar, apple, icloud, caldav, oauth, synchronisation, ical, ics, busy, occupe, blocage, airbnb, double booking, calendrier externe]
repond_a:
  - "Comment les réservations Hifago apparaissent-elles dans l'agenda Google ou Apple d'un partenaire ?"
  - "Comment un rendez-vous pris dans Google ou Apple ferme-t-il un créneau Hifago ?"
  - "Que se passe-t-il si une réservation Hifago et un événement Google tombent sur le même créneau ?"
  - "Où sont stockés les jetons Google et les mots de passe d'application Apple des partenaires ?"
---

# Synchronisation de l'agenda partenaire avec Google Agenda et Apple iCloud

> **Cible stack** : hifago. Périmètre socio (portail `/partner`). Demande de Jérôme le 2026-11-13 ;
> arbitrages pris le même jour, §3. Points encore ouverts : §10.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (API/RPC, modèle de données, invariants, cas limites — pour coder) | brouillon |
| 1 | Contexte et problème | brouillon |
| 2 | Portée | brouillon |
| 3 | Décisions retenues | brouillon |
| 4 | Parcours cible | brouillon |
| 5 | Écran(s) | brouillon |
| 6-9 | *(fusionnées dans 0)* | — |
| 10 | Décisions tranchées / points ouverts | brouillon |
| 11 | Annexe — traçabilité code→règle | à écrire à la livraison |
| 12 | Documents liés | brouillon |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Deux sens, deux mécanismes

| Sens | Google | Apple iCloud | Lien iCal en lecture (Airbnb, Booking, iCloud public…) |
|---|---|---|---|
| Hifago → agenda (écriture) | API Calendar, agenda secondaire « Hifago » créé par Hifago | CalDAV, calendrier « Hifago » créé par `MKCALENDAR` | — (impossible) |
| Agenda → Hifago (occupé) | API free/busy sur les agendas choisis | CalDAV `free-busy-query`/`calendar-query` sur les agendas choisis | Lecture du `.ics`, événements tous opaques |
| Identifiants | Jeton de rafraîchissement OAuth | Identifiant Apple + mot de passe d'application | URL secrète |
| Délai | Écriture : ≤ 1 min (file + cron) · Lecture : ≤ 5 min (cron) | idem | Lecture : ≤ 15 min |

Autorisations Google demandées, les plus étroites possibles (noms exacts à confirmer dans la
console Google au moment du code) : gérer **uniquement les agendas créés par l'appli** (écriture) ;
**libre/occupé seulement** (lecture, jamais le contenu des événements du partenaire) ; liste des
agendas (choix des agendas à lire). Autorisations « sensibles » → validation Google (§10.1).

### Modèle de données (nouveau)

| Table | Colonnes clés | Accès |
|---|---|---|
| `calendar_connections` | `id`, `account_id` → `partner_accounts`, `provider` (`google`/`apple`/`ical_url`), `status` (`active`/`needs_reauth`/`revoked`), `secret_id` uuid (→ `vault.secrets`, jeton/mot de passe/URL — jamais en clair dans la table), `external_account_label` (e-mail Google/Apple affiché), `hifago_calendar_ref` (id Google ou URL CalDAV de l'agenda « Hifago », null pour `ical_url`), `read_calendar_refs` text[] (agendas lus), `last_pull_at`, `last_push_at`, `attempts`, `last_error`, `next_attempt_at` | Lecture : RLS directe, ses propres lignes (`account_id = (select auth.uid())`), `secret_id` révoqué au niveau colonne (patron `lobby_api_token`, migration `20260819110000`). Écriture : RPC-only. |
| `calendar_connection_products` | `connection_id`, `product_id`, PK (les deux) | Lecture : RLS directe propriétaire. Écriture : RPC-only (`set_calendar_connection_products`). |
| `external_busy_blocks` | `id`, `connection_id`, `start_at` timestamptz, `end_at` timestamptz (exclusif), `all_day` bool, `external_uid` text | **RPC-only** (alimente une décision de disponibilité, §3 de `CLAUDE.md`). Lecture partenaire via `get_calendar_conflicts` seulement. |
| `calendar_event_links` | `order_line_id`, `connection_id`, `external_event_id`, `etag`, `synced_hash`, PK (`order_line_id`, `connection_id`) | Service seulement (Edge Function). |
| `calendar_push_queue` | `id`, `order_line_id`, `connection_id`, `op` (`upsert`/`delete`), `attempts`, `last_error`, `next_attempt_at` | Service seulement. Alimentée par trigger sur `order_lines`. |

`notification_emails.event_type` : ajouter `partner_calendar_conflict` et `partner_calendar_needs_reauth`.

### RPC / fonctions

| Nom | Signature | Rôle |
|---|---|---|
| `connect_calendar` | `(p_provider text, p_secret text, p_label text, p_hifago_calendar_ref text default null) returns jsonb` | Appelée par la Route Handler après OAuth/validation CalDAV. Crée la connexion, range `p_secret` dans Vault. `security definer`, `search_path=''`. |
| `set_calendar_connection_products` | `(p_connection_id uuid, p_product_ids uuid[], p_read_calendar_refs text[]) returns jsonb` | Remplace les produits liés et les agendas lus. Refuse tout produit hors des établissements où l'appelant a `has_capability(…,'operator',…)` → `product_not_found`. Refuse les types hors périmètre (§0 Invariants) → `unsupported_product_type`. |
| `disconnect_calendar` | `(p_connection_id uuid) returns jsonb` | Supprime le secret Vault, les blocages et liens ; `status='revoked'`. Les blocages tombent **immédiatement**. |
| `apply_external_busy` | `(p_connection_id uuid, p_window_start timestamptz, p_window_end timestamptz, p_blocks jsonb) returns jsonb` | **RPC critique** (squelette `docs/05-reference-technique.md` §1, skill `/hifago-rpc-critique`, effort `max`). Remplace atomiquement les blocages de la fenêtre ; verrouille `for update` les lignes `product_availability`/`product_slot_availability` touchées **dans l'ordre de `lock_order_capacity_rows`** ; détecte les réservations `reserved` chevauchantes → met en file `partner_calendar_conflict`. Service seulement. |
| `product_externally_blocked` | `(p_product_id uuid, p_start timestamptz, p_end timestamptz) returns boolean` | `STABLE`, `security definer`, `search_path=''`. Vrai si un blocage d'une connexion `active` liée au produit chevauche l'intervalle (règle de chevauchement : Invariants). |
| `get_calendar_conflicts` | `(p_from date, p_to date) returns setof …` | Pour l'agenda socio : blocages externes (début, fin, connexion) — jamais le titre de l'événement. |

### Points d'accroche dans les RPC existantes (même garde que `product_calendar.open` → `date_closed`)

`create_order`, `cart_lines_availability`, `create_manual_order_line`, `modify_order_line`,
`search_catalog`, `get_product_slots` (+ `expand_product_slots` si elle filtre l'affichage).
Nouveau motif de refus : `externally_blocked` (distinct de `date_closed`, pour le message socio).
Aucun appel réseau vers Google/Apple dans aucune de ces fonctions.

### Edge Functions et cron

| Fonction | Cron | Rôle |
|---|---|---|
| `calendar-push` | chaque minute | Dépile `calendar_push_queue` : crée/modifie/supprime l'événement ; backoff exponentiel (patron `fail_pms_sync`, migration `20260918170000`). |
| `calendar-pull` | toutes les 5 min (`ical_url` : 15 min) | Lit l'occupé sur [maintenant − 1 j, maintenant + 365 j] par connexion active, appelle `apply_external_busy`. |
| Route Handler `apps/admin/app/partner/calendar/google/callback` | — | Retour OAuth, échange du code, création de l'agenda « Hifago », `connect_calendar`. |
| Route Handler `apps/admin/app/partner/calendar/apple` | — | Valide l'identifiant + mot de passe par un `PROPFIND` CalDAV, crée l'agenda « Hifago », `connect_calendar`. |

### Invariants

- **Écriture** : seule une ligne `reserved` dont la commande n'attend plus de paiement
  (`not order_awaits_payment(order_id)`) est écrite ; tout passage à `cancelled_*`/`expired`/
  `superseded` → `delete` ; changement de date/qty/horaire → `upsert`. Les walk-in sont écrits aussi.
- Événement écrit : titre `"${nom_produit} - ${holder_name} - ${qty} pers."` (même format que
  l'agenda, spec 20) ; description : téléphone, e-mail, lien vers `/partner/reservations/[id]` ;
  UID stable `hifago-ol-${order_line_id}` ; fuseau `America/Bogota` ; positionnement identique
  à la spec 20 §0 (créneau → heure + durée ; logement → journée entière de `date` à `end_date`
  exclusif ; date simple → journée entière).
- Hifago n'écrit **jamais** ailleurs que dans son agenda « Hifago », et ne le lit **jamais** comme
  source d'occupé (exclu de `read_calendar_refs` ; tout UID `hifago-ol-*` ignoré par sécurité).
- **Occupé = créneau fermé** pour les produits liés, jamais des places retirées.
- Chevauchement : produit à créneau → bloqué si `[début créneau, fin créneau[` chevauche un
  blocage ; activité à date simple et nuit de logement → bloquées seulement par un blocage
  `all_day` couvrant ce jour, ou un blocage horaire couvrant **toute** la journée (§10.3).
- Événements « disponible » (transparents), refusés ou annulés : ignorés. Récurrences : développées
  par le fournisseur (free/busy) ou par `calendar-pull` (`.ics`).
- Types couverts : `activity` (créneau ou date) et `lodging` **hors PMS**. Exclus : `hotel`, tout
  produit d'un établissement `lobby_connector_active`, `camp`, `transport`, événements.
- Les blocages externes ne modifient jamais `product_calendar` ni les capacités : un événement
  retiré dans Google rouvre le créneau sans écraser une fermeture manuelle.
- **Conflit** (blocage arrivé après une réservation payée) : la réservation est maintenue, le
  partenaire reçoit `partner_calendar_conflict` (une fois par couple ligne × blocage), l'agenda
  socio montre le conflit. Jamais d'annulation automatique.
- Secrets : uniquement dans Vault, jamais renvoyés au navigateur, jamais journalisés.

### Cas limites

| Situation | Traitement |
|---|---|
| Google renvoie `invalid_grant` / Apple 401 | `status='needs_reauth'`, e-mail `partner_calendar_needs_reauth`, blocages **conservés** (§10.2 pour la péremption). |
| Le partenaire supprime l'agenda « Hifago » chez lui | `calendar-push` reçoit 404 → recrée l'agenda, réécrit les lignes futures. |
| Le partenaire modifie à la main un événement Hifago | Écrasé au prochain `upsert` de la ligne ; Hifago ne relit jamais cet agenda. |
| Deux connexions liées au même produit | Les blocages s'additionnent (un seul suffit à fermer). |
| Produit lié retiré de la connexion | Ses blocages cessent de s'appliquer immédiatement (jointure). |
| Établissement passé sous LobbyPMS | `product_externally_blocked` ne s'applique plus ; lien affiché « exclu (PMS) ». |
| Panne prolongée de Google/Apple | Voir §10.2 (échec fermé ou non) — non tranché. |
| Fenêtre de course réservation ↔ occupé | Sérialisée par les verrous de `apply_external_busy` : le conflit est soit refusé à la réservation (`externally_blocked`), soit alerté — jamais silencieux. Test de concurrence à barrière obligatoire. |

---

## 1. Contexte et problème

Le partenaire voit ses réservations dans l'agenda du portail (spec 20), mais vit au quotidien
dans Google Agenda ou dans le calendrier de son iPhone. Deux conséquences : il ne voit pas une
réservation Hifago sans ouvrir le portail, et un rendez-vous pris ailleurs (client direct, Airbnb,
rendez-vous personnel) ne ferme pas le créneau sur Hifago, d'où un risque de double réservation.
Les prestataires seuls (guide, professeur, coach), dont l'agenda personnel *est* la disponibilité,
sont les premiers concernés. Les hôtels sous LobbyPMS ne le sont pas : Lobby fait déjà foi.

## 2. Portée

**Dans le périmètre** : connexion Google (OAuth) et Apple iCloud (CalDAV, mot de passe
d'application), écriture des réservations dans un agenda « Hifago » dédié, lecture de l'occupé
des agendas choisis, lien iCal en lecture (Airbnb, Booking, iCloud public) pour le sens retour,
liaison connexion → produits, alertes de conflit et de reconnexion, affichage des blocages dans
l'agenda socio.

**Hors périmètre** : flux `.ics` exporté par Hifago (écarté par Jérôme le 2026-11-13) ; Outlook/
Microsoft 365 (même architecture, à ajouter si demandé) ; retrait de N places selon un événement ;
annulation automatique en cas de conflit ; vue admin des connexions de tous les partenaires
(une colonne « agenda connecté » sur la fiche partenaire suffira plus tard).

## 3. Décisions retenues (Jérôme, 2026-11-13)

1. **Deux sens, Google et Apple.** Le lien `.ics` exporté par Hifago est écarté : Google ne
   rafraîchit un agenda abonné qu'après plusieurs heures.
2. **Occupé = créneau fermé**, jamais des places retirées (lire un nombre dans un titre libre est
   trop fragile).
3. **Produits couverts : activités et logements hors PMS.** Le lien iCal en lecture rend la
   synchro utile aux logements déjà présents sur Airbnb ou Booking.
4. **Conflit : la réservation Hifago gagne**, le partenaire est alerté et règle lui-même.
5. **Apple par mot de passe d'application** (procédé de Calendly et Cal.com), stocké chiffré.
6. Conséquences techniques retenues dans le même geste : les blocages vivent dans leur propre
   table (jamais dans `product_calendar`) ; la réservation consulte la base, jamais Google ou Apple
   (`CLAUDE.md` §4.1, un seul aller-retour) ; secrets dans Supabase Vault, déjà utilisé par les crons
   PMS (migration `20260819140000`) ; lecture de l'occupé par interrogation toutes les 5 minutes
   plutôt que par notifications push Google (aucune autorisation de lecture du contenu des
   événements, aucun canal à renouveler chaque semaine, même mécanisme pour Apple).

## 4. Parcours cible

1. Portail → « Mi agenda » → « Conectar Google » ou « Conectar Apple » (ou « Añadir enlace iCal »).
2. **Google** : écran de consentement Google → retour au portail ; Hifago crée l'agenda « Hifago »
   dans son compte. **Apple** : un tutoriel de deux minutes (créer un mot de passe d'application sur
   appleid.apple.com), saisie de l'identifiant Apple et du mot de passe, vérification immédiate.
3. Choix des agendas à lire comme « occupé » (par défaut : l'agenda principal) et des produits à
   protéger (par défaut : toutes ses activités et ses logements hors PMS).
4. Dès la minute suivante, ses réservations à venir apparaissent dans l'agenda « Hifago ».
5. Il prend un rendez-vous dans son agenda : dans les 5 minutes, les créneaux qui le chevauchent
   ne sont plus réservables sur Hifago, et l'agenda socio les montre grisés (« Ocupado en Google »).
6. En cas de conflit : e-mail « Conflicto con tu agenda » et repère sur la réservation.
7. « Desconectar » : tout cesse immédiatement ; l'agenda « Hifago » reste chez lui (Hifago ne
   supprime rien dans son compte après révocation, faute d'accès).

## 5. Écran(s)

**`/partner/agenda/conexiones`** (ou section de `/partner/settings`, à trancher au code) : une
carte par connexion (fournisseur, compte, état, dernière synchro, erreur lisible), bouton
« Reconectar » si `needs_reauth`, choix des agendas lus et des produits liés, « Desconectar ».
Responsive obligatoire (`.claude/rules/ui.md`).

**Agenda socio (`/partner`, spec 20)** : les blocages externes en bandes grisées non cliquables
(sans titre : seule l'occupation est lue) ; repère « conflicto » sur une réservation chevauchée.

## 10. Décisions tranchées / points ouverts

1. **Validation Google** (Jérôme s'en charge) : à soumettre **après** avoir codé et testé la
   connexion en mode Test, car Google exige une vidéo de démonstration de l'usage réel des
   autorisations. À préparer dès maintenant : politique de confidentialité sur hifago.co
   mentionnant les données Agenda, domaine vérifié dans la console, écran de consentement publié
   (déjà au backlog, « Étape DNS »). En mode Test, 100 testeurs au plus, et la connexion expire au
   bout de 7 jours d'après la documentation Google (à vérifier au moment du test).
2. 🔶 **Échec fermé ou non, arbitrage Jérôme requis.** `CLAUDE.md` §4.4 impose de bloquer une
   réservation quand un service dont elle dépend est indisponible. Si la lecture d'une connexion
   échoue depuis plus de N heures (jeton révoqué, panne Apple), faut-il fermer les produits liés
   (sûr, mais une panne Google coupe les ventes du partenaire) ou continuer avec les derniers
   blocages connus et alerter ? Proposition : fermer au-delà de 2 h sans lecture réussie, avec
   alerte au partenaire dès la première heure.
3. 🔶 **Activité à date simple et événement court** : un rendez-vous de 14 h à 15 h doit-il fermer
   une activité vendue « à la journée » sans horaire ? Proposition : non (seul un événement d'une
   journée entière la ferme), sinon un rendez-vous chez le dentiste fermerait toute la journée.
4. Chiffrement : Vault est retenu ici pour ces nouveaux secrets ; le jeton LobbyPMS reste en clair
   à part (spec 21 §10 point 5, non tranché) — à aligner le jour où ce point se tranche.
5. Données personnelles : l'événement écrit chez le partenaire contient le nom, le téléphone et
   l'e-mail du client (le partenaire les voit déjà dans sa fiche depuis le 2026-08-19). Ils sortent
   de Hifago vers Google ou Apple : à mentionner dans la politique de confidentialité.

## 11. Annexe — traçabilité code→règle

À écrire à la livraison.

## 12. Documents liés

- `docs/specs/20-agenda-reservations-socio.md` — agenda socio, format des événements, positionnement.
- `docs/specs/17-calendrier-disponibilite-refonte.md` — fermetures `product_calendar`, cupos.
- `docs/specs/21-*` / `docs/specs/24-modele-hebergement-et-surface-lobbypms.md` — patron connecteur
  externe, file, backoff, exclusion des établissements PMS.
- `docs/05-reference-technique.md` §1 — squelette de `apply_external_busy` et test de concurrence.
- `docs/06-emails-transactionnels.md` — deux nouveaux e-mails partenaire.
