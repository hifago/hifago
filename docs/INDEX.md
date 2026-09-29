# Carte de la documentation hifago/

> Générée par `npm run docs:index` (hooks pre-commit et pre-merge-commit) — ne pas éditer à la main.
> Point d'entrée unique, humains et IA. Liens relatifs à `docs/`.
>
> 1. Repérer le document ci-dessous — ou dans les Raccourcis si le sujet n'est pas un titre.
> 2. Spec : Read avec l'`offset`/`limit` de sa §0 — le contrat pour coder, qui suffit seul.
> 3. Autre document de plus de 40 Ko : un Read sans `offset` est refusé et renvoie son plan avec l'offset/limit
>    de chaque section (hook `scripts/hooks/guard-doc-read.mjs`) ; `offset=1` pour une lecture entière délibérée.
> 4. Sujet introuvable ici : `grep -i <mot> docs/ai-index.json` (une ligne par document : résumé, mots-clés, questions).
> 5. État courant : `grep -n '^## 20' docs/journal/*.md | tail -5`, puis Read avec `offset` et `limit`.
>
> Specs : ✓ livrée · ◐ partielle (lire « reste ») · ○ brouillon · ✗ supprimée (→ remplaçante).
> Le cadrage (00-06) décrit la cible, pas forcément ce qui est livré. En cas de contradiction, la spec
> livrée ou partielle la plus récente prime sur le cahier ; sinon le code fait foi, puis `04-architecture-cible.md`.

## Raccourcis
- quoi faire maintenant, points ouverts, arbitrages en attente de Jérôme → [backlog.md](backlog.md)
- stack, architecture, décisions déjà tranchées à ne pas rouvrir → [04-architecture-cible.md](04-architecture-cible.md)
- squelette RPC anti-survente, test de concurrence, recherche géo+JSONB à copier → [05-reference-technique.md](05-reference-technique.md)
- modèle de données : entités et champs (établissement, produit, compte) → [00-modele-de-donnees.md](00-modele-de-donnees.md)
- emails transactionnels : envois, déclencheurs, destinataires → [06-emails-transactionnels.md](06-emails-transactionnels.md)
- SEO : sitemap, robots.txt, hreflang, JSON-LD → [specs/26-referencement-seo-et-moteurs-ia.md](specs/26-referencement-seo-et-moteurs-ia.md)
- pièges empiriques numérotés (`CLAUDE.md §11.N`) → [pieges-empiriques.md](pieges-empiriques.md)
- écrire une spec : les questions à poser, puis le gabarit → [specs/avant-la-spec.md](specs/avant-la-spec.md), [specs/_modele.md](specs/_modele.md)

## Cadrage — la cible de la refonte
- [Audit du modèle de données cible — entités partagées](00-modele-de-donnees.md) 56K
- [Cahier des charges — portail client (marketplace global, Guatapé =…](01-cahier-des-charges-client.md) 96K
- [Cahier des charges — portail socio (aujourd'hui /partner)](02-cahier-des-charges-socio.md) 56K
- [Cahier des charges — back-office admin (aujourd'hui /admin)](03-cahier-des-charges-admin.md) 49K
- [Choix de stack et architecture cible](04-architecture-cible.md) 78K
- [Référence technique — patterns validés et extensions requises](05-reference-technique.md) 9K
- [Emails transactionnels — les 11 envois possibles, leur déclencheur…](06-emails-transactionnels.md) 12K

## Specs — une feature chacune
- [Admin crée un partenaire](specs/01-admin-creation-partenaire.md) 21K ✓ · sans §0
- [Admin : sidebar de navigation et page d'accueil](specs/02-admin-accueil-et-navigation.md) 23K ✓ · sans §0
- [Admin crée un établissement (identité, rattachement, présentation…](specs/03-admin-creation-etablissement.md) 24K ✓ · sans §0
- [Gestion des images — upload, droits, recadrage, affichage](specs/04-gestion-images.md) 33K ✓ · sans §0
- [Invitations partenaire : dashboard d'atterrissage, visibilité…](specs/05-invitations-onboarding-dashboard-partenaire.md) 23K ✓ · sans §0
- [Gestion d'un établissement — admin édite, partenaire propose…](specs/06-gestion-etablissement.md) 51K ✓ · §0 offset 57 limit 60
- [Connexion/inscription complète : Google, email+mot de passe,…](specs/07-connexion-inscription-complete.md) 36K ✓ · sans §0
- [Admin gère une activité (tags, paliers de prix, bornes de quantité,…](specs/08-admin-gestion-activite.md) 25K ✓ · sans §0
- [Design system admin — fond beige, coins carrés (piste Argile)](specs/09-design-system-admin.md) 17K ✓ · §0 offset 40 limit 97
- [Listes admin/socio standardisées — pagination, tri, filtres,…](specs/10-listes-standardisees-admin-socio.md) 51K ✓ · §0 offset 53 limit 108
- [Admin : parcours unifié création/édition d'une activité — i18n…](specs/11-admin-activite-parcours-unifie-creneaux.md) 17K ✓ · §0 offset 51 limit 63
- [Admin : active products.type='lodging' (« house ») dans le parcours…](specs/12-admin-alojamiento-house.md) 18K ✓ · §0 offset 56 limit 75
- [Admin : active products.type='hotel' — un hôtel a plusieurs…](specs/13-admin-hotel-habitaciones.md) 27K ✗ → 24
- [Admin : active products.type='transport' dans le parcours produit —…](specs/14-admin-transporte.md) 22K ✓ · §0 offset 120 limit 60
- [Socio : proposer la création d'une nouvelle fiche produit](specs/15-socio-creation-produit.md) 19K ✓ · §0 offset 53 limit 82
- [Notifications toast succès/échec sur toute…](specs/16-notifications-toast.md) 18K ✓ · §0 offset 44 limit 113
- [Calendrier/disponibilité — audit complet + refonte phasée (Tranches…](specs/17-calendrier-disponibilite-refonte.md) 57K ◐ · §0 offset 75 limit 241 · reste : Tranche 1 (crash price_cop null, Mis Reservas) et Tranche 2 (SVAR, moteur unifié…
- [Créneaux horaires réellement réservables (product_slot_rules)](specs/18-creneaux-horaires-reservables.md) 36K ✓ · §0 offset 59 limit 53
- [Paiement en ligne Mercado Pago — acompte obligatoire, ledger de…](specs/19-paiement-mercadopago-acompte-ledger.md) 53K ◐ · §0 offset 78 limit 370 · reste : Tranche 1 (capture d'acompte, CheckoutForm branché, ledger) livrée et vérifiée en…
- [Agenda de réservations socio (vue jour/semaine/mois)](specs/20-agenda-reservations-socio.md) 26K ✓ · §0 offset 42 limit 55
- [Connecteur LobbyPMS — contrat générique multi-prestataire](specs/21-connecteur-lobbypms.md) 42K ◐ · §0 offset 60 limit 57 · reste : Tranche 1 implémentée le 2026-08-19, disponibilité live côté client comblée le…
- [Vue référent restreinte — pas d'établissement/mis reservas, liste…](specs/22-vue-referent-restreinte.md) 13K ✓ · §0 offset 43 limit 77
- [Notifications email transactionnelles (invitation, modération,…](specs/23-notifications-email-transactionnelles.md) 49K ✓ · §0 offset 62 limit 167
- [Surface LobbyPMS exploitée, parcours front d'un produit lié, et…](specs/24-modele-hebergement-et-surface-lobbypms.md) 33K ◐ · §0 offset 60 limit 71 · reste : Lot A implémenté le 2026-08-26 ; Lot B gelé (observation préprod requise) ; T1/T2/T3 de…
- [Propagation d'une annulation hifago vers LobbyPMS (C2)](specs/25-propagation-annulation-lobbypms.md) 11K ✓ · sans §0
- [Référencement de la vitrine : Google et moteurs de réponse IA](specs/26-referencement-seo-et-moteurs-ia.md) 31K ✓ · §0 offset 47 limit 83
- [Architecture de la vitrine : routes, zones, coquilles et couche…](specs/27-architecture-vitrine-et-routage.md) 32K ✓ · §0 offset 52 limit 116
- [Vitrine : l'accueil, qui est aussi l'écran de résultats de recherche](specs/28-vitrine-accueil-et-resultats.md) 47K ✓ · §0 offset 57 limit 153
- [Vitrine : les pages de listing et l'index de catégories](specs/29-vitrine-listings-et-index-de-categories.md) 70K ✓ · §0 offset 67 limit 196
- [Vitrine : les fiches produit et établissement](specs/30-vitrine-fiches-produit-et-etablissement.md) 82K ✓ · §0 offset 68 limit 218
- [Identité anonyme de l'invité](specs/31-identite-anonyme.md) 21K ◐ · §0 offset 45 limit 137 · reste : Les 4 tranches sont livrées (2026-09-10). Reste le point de vérification de la Tranche 4…
- [Panier en base](specs/32-panier-en-base.md) 24K ✓ · §0 offset 48 limit 90
- [L'écran de résultat de paiement et la fermeture du tunnel](specs/33-resultat-paiement-et-fermeture-du-tunnel.md) 46K ✓ · §0 offset 57 limit 215
- [Compte client : « Mis reservas », la liste et le détail](specs/34-compte-mes-reservations.md) 52K ✓ · §0 offset 66 limit 120
- [Compte client : profil, édition, déconnexion, suppression](specs/35-compte-profil.md) 32K ✓ · §0 offset 63 limit 45
- [Remise par seuil de remplissage cumulé (camps)](specs/36-remise-remplissage-camp.md) 16K ✓ · §0 offset 56 limit 80
- [Programme jour par jour d'un camp](specs/37-programme-camp.md) 15K ✓ · §0 offset 53 limit 70
- [Remise en route de la suite E2E Playwright](specs/38-remise-en-route-suite-e2e.md) 8K ○ · sans §0
- [Garantir la confirmation d'un paiement quand le client ne revient pas](specs/39-garantie-confirmation-paiement.md) 30K ◐ · §0 offset 144 limit 57 · reste : Lot A + B1 + B2 livrés et vérifiés en local le 2026-09-22 (§C). Restent : validation par…
- [Assistant par étapes — création/édition produit et établissement,…](specs/40-admin-produit-etablissement-assistant-par-etapes.md) 11K ✓ · §0 offset 41 limit 44
- [Specs — fonctionnalités prêtes à coder, une par une](specs/README.md) 3K
- [Gabarit de spec de feature (à copier, ne décrit aucune feature réelle)](specs/_modele.md) 7K
- [Avant d'écrire une spec — poser les bonnes questions](specs/avant-la-spec.md) 8K

## Suivi — backlog, dette, pièges, journal
- [Backlog hifago — points ouverts et arbitrages en attente](backlog.md) 12K
- [Dette technique et QA/UI connue — hifago](dette-technique.md) 32K
- [Journal hifago — août 2026](journal/2026-08.md) 660K · jamais en entier (voir 5.)
- [Journal hifago — septembre 2026](journal/2026-09.md) 661K · jamais en entier (voir 5.)
- [Pièges empiriques hifago — index numéroté](pieges-empiriques.md) 5K
