# Index de la documentation hifago/

> Généré par `npm run docs:index` — ne pas éditer à la main. Sommaire **humain** ; le
> `docs/ai-index.json` voisin sert le même contenu à une IA (table de routage sujet → document).
> Un seul fichier à ouvrir pour savoir ce qui existe : celui-ci.

## Cadrage — architecture, modèle de données, cahiers des charges
- [Audit du modèle de données cible — entités partagées](00-modele-de-donnees.md)
- [Cahier des charges — portail client (marketplace global, Guatapé = première localisation)](01-cahier-des-charges-client.md)
- [Cahier des charges — portail socio (aujourd'hui /partner)](02-cahier-des-charges-socio.md)
- [Cahier des charges — back-office admin (aujourd'hui /admin)](03-cahier-des-charges-admin.md)
- [Choix de stack et architecture cible](04-architecture-cible.md)
- [Référence technique — patterns validés et extensions requises](05-reference-technique.md)
- [Emails transactionnels — les 11 envois possibles, leur déclencheur et leur destinataire](06-emails-transactionnels.md)

## Specs — features prêtes à coder ou livrées
- [Admin crée un partenaire](specs/01-admin-creation-partenaire.md) — **Implémenté**
- [Admin : sidebar de navigation et page d'accueil](specs/02-admin-accueil-et-navigation.md) — **Implémenté**
- [Admin crée un établissement (identité, rattachement, présentation basique)](specs/03-admin-creation-etablissement.md) — **Implémenté**
- [Gestion des images — upload, droits, recadrage, affichage](specs/04-gestion-images.md) — **Implémenté**
- [Invitations partenaire : dashboard d'atterrissage, visibilité établissement, gestion admin](specs/05-invitations-onboarding-dashboard-partenaire.md) — **Implémenté**
- [Gestion d'un établissement — admin édite, partenaire propose (création et édition)](specs/06-gestion-etablissement.md) — **Implémenté**
- [Connexion/inscription complète : Google, email+mot de passe, vérification, mot de passe oublié, 2FA admin](specs/07-connexion-inscription-complete.md) — **Implémenté**
- [Admin gère une activité (tags, paliers de prix, bornes de quantité, suppression réelle)](specs/08-admin-gestion-activite.md) — **Implémenté**
- [Design system admin — fond beige, coins carrés (piste Argile)](specs/09-design-system-admin.md) — **Implémenté**
- [Listes admin/socio standardisées — pagination, tri, filtres, composant réutilisable](specs/10-listes-standardisees-admin-socio.md) — **Implémenté**
- [Admin : parcours unifié création/édition d'une activité — i18n nom/description, lieu, photos dès la création, module de créneaux horaires récurrents](specs/11-admin-activite-parcours-unifie-creneaux.md) — **Implémenté**
- [Admin : active products.type='lodging' (« house ») dans le parcours produit — check-in/check-out, capacité, extras de tarification (saison, week-end, dépôt, inclusiones)](specs/12-admin-alojamiento-house.md) — **Implémenté**
- [Admin : active products.type='hotel' — un hôtel a plusieurs sous-produits qui sont des chambres, chacune avec son propre prix/capacité](specs/13-admin-hotel-habitaciones.md) — **Supprimée** (reste : Supprimée le 2026-08-27 (T3 de la spec 24) — l'étage hôtel n'existe plus, ni en code ni…)
- [Admin : active products.type='transport' dans le parcours produit — lieu + tags + prix par tramos de capacité de véhicule, réutilisation intégrale du ProductForm unifié](specs/14-admin-transporte.md) — **Implémenté**
- [Socio : proposer la création d'une nouvelle fiche produit](specs/15-socio-creation-produit.md) — **Implémenté**
- [Notifications toast succès/échec sur toute création/édition/suppression (admin + socio)](specs/16-notifications-toast.md) — **Implémenté**
- [Calendrier/disponibilité — audit complet + refonte phasée (Tranches 0-2 prêtes à coder)](specs/17-calendrier-disponibilite-refonte.md) — **Partiel** (reste : Tranche 1 (crash price_cop null, Mis Reservas) et Tranche 2 (SVAR, moteur unifié…)
- [Créneaux horaires réellement réservables (product_slot_rules)](specs/18-creneaux-horaires-reservables.md) — **Implémenté**
- [Paiement en ligne Mercado Pago — acompte obligatoire, ledger de règlement, virement automatique au référent](specs/19-paiement-mercadopago-acompte-ledger.md) — **Partiel** (reste : Tranche 1 (capture d'acompte, CheckoutForm branché, ledger) livrée et vérifiée en…)
- [Agenda de réservations socio (vue jour/semaine/mois)](specs/20-agenda-reservations-socio.md) — **Implémenté**
- [Connecteur LobbyPMS — contrat générique multi-prestataire](specs/21-connecteur-lobbypms.md) — **Partiel** (reste : Tranche 1 implémentée le 2026-08-19, disponibilité live côté client comblée le…)
- [Vue référent restreinte — pas d'établissement/mis reservas, liste des ventes attribuées](specs/22-vue-referent-restreinte.md) — **Implémenté** (reste : Validé par Jérôme le 2026-08-20.)
- [Notifications email transactionnelles (invitation, modération, paiement, réconciliation)](specs/23-notifications-email-transactionnelles.md) — **Implémenté** (reste : Tranche 1 + Tranche 2 livrées. Envoi réel Resend confirmé le 2026-08-31 (8 emails reçus…)
- [Surface LobbyPMS exploitée, parcours front d'un produit lié, et cible du modèle hébergement](specs/24-modele-hebergement-et-surface-lobbypms.md) — **Partiel** (reste : Lot A implémenté le 2026-08-26 ; Lot B gelé (observation préprod requise) ; T1/T2/T3 de…)
- [Propagation d'une annulation hifago vers LobbyPMS (C2)](specs/25-propagation-annulation-lobbypms.md) — **Implémenté** (reste : Vérifiée en conditions réelles le 2026-08-27 (booking créé puis annulé chez Casa Kayam)…)
- [Référencement de la vitrine : Google et moteurs de réponse IA](specs/26-referencement-seo-et-moteurs-ia.md) — **Implémenté** (reste : Vérifiée en local le 2026-09-01 (build, serveur réel, 3 e2e). Validation par un outil…)
- [Architecture de la vitrine : routes, zones, coquilles et couche d'accès aux données](specs/27-architecture-vitrine-et-routage.md) — **Implémenté**
- [Vitrine : l'accueil, qui est aussi l'écran de résultats de recherche](specs/28-vitrine-accueil-et-resultats.md) — **Implémenté** (reste : Les 3 tranches sont livrées (Tranche 3 le 2026-09-13). Un seul point reste ouvert : le…)
- [Vitrine : les pages de listing et l'index de catégories](specs/29-vitrine-listings-et-index-de-categories.md) — **Implémenté**
- [Vitrine : les fiches produit et établissement](specs/30-vitrine-fiches-produit-et-etablissement.md) — **Implémenté**
- [Identité anonyme de l'invité](specs/31-identite-anonyme.md) — **Partiel** (reste : Les 4 tranches sont livrées (2026-09-10). Reste le point de vérification de la Tranche 4…)
- [Panier en base](specs/32-panier-en-base.md) — **Implémenté**
- [L'écran de résultat de paiement et la fermeture du tunnel](specs/33-resultat-paiement-et-fermeture-du-tunnel.md) — **Implémenté**
- [Compte client : « Mis reservas », la liste et le détail](specs/34-compte-mes-reservations.md) — **Implémenté**
- [Compte client : profil, édition, déconnexion, suppression](specs/35-compte-profil.md) — **Implémenté**
- [Remise par seuil de remplissage cumulé (camps)](specs/36-remise-remplissage-camp.md) — **Implémenté**
- [Programme jour par jour d'un camp](specs/37-programme-camp.md) — **Implémenté**
- [Remise en route de la suite E2E Playwright](specs/38-remise-en-route-suite-e2e.md) — **Brouillon**
- [Garantir la confirmation d'un paiement quand le client ne revient pas](specs/39-garantie-confirmation-paiement.md) — **Partiel** (reste : Lot A + B1 + B2 livrés et vérifiés en local le 2026-09-22 (§C). Restent : validation par…)
- [Assistant par étapes — création/édition produit et établissement, écran de confirmation](specs/40-admin-produit-etablissement-assistant-par-etapes.md) — **Implémenté**
- [Specs — fonctionnalités prêtes à coder, une par une](specs/README.md) — **actif**
- [Gabarit de spec de feature (à copier, ne décrit aucune feature réelle)](specs/_modele.md) — **modele**
- [Avant d'écrire une spec — poser les bonnes questions](specs/avant-la-spec.md) — **modele**

## Journal — historique chronologique (jamais chargé automatiquement)
- [Backlog hifago — points ouverts et arbitrages en attente](backlog.md)
- [Dette technique et QA/UI connue — hifago](dette-technique.md)
- [Journal hifago — août 2026](journal/2026-08.md)
- [Journal hifago — septembre 2026](journal/2026-09.md)
- [Pièges empiriques hifago — index numéroté](pieges-empiriques.md)
