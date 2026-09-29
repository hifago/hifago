---
id: specs-modele
titre: "Gabarit de spec de feature (à copier, ne décrit aucune feature réelle)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: modele
maj: 2026-08-15
resume: >
  Gabarit à recopier pour spécifier une nouvelle fonctionnalité jusqu'au niveau prêt à coder.
  Section 0 en tête : un contrat compact (API/RPC, données, invariants, cas limites) qu'un agent
  qui code peut lire seul, sans parcourir le reste — le reste du document sert la traçabilité et
  l'audit humain.
mots_cles: [gabarit, modele, spec, feature, template, contrat compact]
repond_a:
  - "Quelle structure doit avoir une spec de feature ?"
  - "Qu'est-ce qu'un agent doit lire pour coder à partir d'une spec sans tout parcourir ?"
---

> ⚠️ **Ce document ne décrit aucune feature réelle.** Le copier vers
> `docs/specs/<NN>-<slug-kebab>.md` et remplacer les `<…>` : le commit l'inscrit tout seul dans la
> carte `docs/INDEX.md` (hook pre-commit). `npm run docs:check` exige une §0 de 150 lignes au plus.
>
> Champs d'en-tête selon le statut : `reste: >` (obligatoire si `partiel` : ce qui manque) ;
> `remplace_par: [NN]` (obligatoire si `supprimee` : la spec qui la remplace, vérifiée) ;
> `revise:` (les sections de cahier `00`-`03` que la spec révise).
>
> Ne pas confondre avec le skill générique `/spec` (gstack), qui crée une **issue GitHub** en
> 5 phases — outil différent, pour un usage différent (suivi de ticket, pas contrat technique
> tracé). Pour spécifier une feature hifago, copier ce gabarit directement, jamais `/spec`.

---
id: specs-<slug>
titre: "<Titre court de la feature>"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: brouillon
maj: <AAAA-MM-JJ>
resume: >
  <Une phrase : ce que fait la feature et pour qui.>
mots_cles: [<mots clés>]
repond_a:
  - "<Question à laquelle ce document répond>"
---

# <Titre de la feature>

> **Cible stack** : <hifago | legacy | les deux>. **Feature n°<N>** si applicable (numéro de
> build hifago, distinct du numéro de fichier `NN-` ci-dessus qui est un compteur de docs).

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (API/RPC, modèle de données, invariants, cas limites — pour coder) | brouillon |
| 1 | Contexte et problème | brouillon |
| 2 | Portée | brouillon |
| 3 | Décisions retenues | brouillon |
| 4 | Parcours cible | brouillon |
| 5 | Écran(s) | brouillon |
| 6-9 | *(fusionnées dans 0 — Modèle de données, Contrat API/RPC, Règles et invariants, Cas limites — détaillées ici seulement si la justification ne tient pas en une ligne dans 0)* | — |
| 10 | Décisions tranchées / points ouverts | brouillon |
| 11 | Annexe — traçabilité code→règle | brouillon |
| 12 | Documents liés | brouillon |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

<!-- Rédiger CETTE section EN DERNIER, après avoir travaillé 1-5 et 10 plus bas — copier les
     faits ici, ne jamais reformuler ni dupliquer un raisonnement. Format table/liste
     uniquement, ZÉRO prose de justification (elle appartient aux sections narratives plus bas).
     Cible : 80-150 lignes (plafond vérifié par `docs:check`). Un agent qui code à partir de cette
     spec ne lit QUE cette section 0 par défaut — la carte `docs/INDEX.md` lui en donne
     l'offset/limit ; il ouvre 1-12 seulement en cas de doute ou de contradiction apparente.
     APRÈS LIVRAISON, cette section est RÉÉCRITE, jamais complétée : un changement ultérieur (spec
     suivante, renommage, signature d'RPC) se corrige ici même ; le récit va au journal, et une
     seule section « Écarts post-livraison » peut dire ce que le code a changé au texte — pas de
     §10bis/§10ter. Seul garde-fou mécanique : les chemins de code cités ici doivent exister
     (`docs:check`) ; le reste de la règle tient à la relecture. -->

### Endpoints / RPC

<!-- Signature exacte (nom, paramètres, retour), squelette de sécurité réutilisé
     (`hifago/docs/05-reference-technique.md`) — pas de prose, juste la signature et un renvoi. -->

### Modèle de données (delta)

<!-- Table par table : créé / réutilisé tel quel / mort-à-activer. Colonnes et types, pas de
     justification (la justification va en 6-9 si besoin). -->

### Invariants

<!-- Liste sèche, un invariant par ligne. -->

### Cas limites

<!-- Liste sèche, un cas par ligne : situation → traitement attendu. -->

### Fichiers touchés

<!-- Liste des fichiers à créer/modifier, sans prose (renvoie à la §11 pour le détail et la
     traçabilité vers le code legacy). -->

## 1. Contexte et problème

<!-- Pourquoi cette feature : ce qui existe aujourd'hui (legacy et/ou décision déjà validée),
     le manque constaté, ce qui déclenche la spec maintenant. Toujours ancré dans du réel —
     jamais une hypothèse. -->

## 2. Portée

<!-- Ce que la feature couvre (in) et ce qu'elle renvoie explicitement à une autre spec/un autre
     lot (out). -->

## 3. Décisions retenues

<!-- Décisions déjà actées ailleurs (cahier des charges, échange avec Jérôme) qui s'appliquent
     ici et ne sont pas rouvertes. -->

## 4. Parcours cible

<!-- Le chemin utilisateur/système pas à pas, du déclenchement au résultat final. -->

## 5. Écran(s)

<!-- Regroupement fonctionnel des champs/actions par écran ou par bloc. -->

## 6. Modèle de données

<!-- Table par table : ce qui existe déjà et se réutilise tel quel, ce qui existe mais est mort
     et à activer, ce qui n'existe pas et est à créer — avec la justification de chaque ajout.
     Le résumé sec de ce contenu vit en §0 ; ici, la justification complète si elle dépasse une
     ligne. -->

## 7. Contrat API/RPC

<!-- Signature(s) candidates, squelette de sécurité réutilisé (référence au squelette déjà
     validé du projet, jamais réinventé). Idem : résumé sec en §0, justification ici. -->

## 8. Règles et invariants

<!-- Ce qui doit rester vrai après cette feature, y compris les invariants transverses déjà en
     vigueur ailleurs dans le système. Idem : liste sèche en §0, justification ici. -->

## 9. Cas limites

<!-- Situations exceptionnelles et leur traitement attendu. Idem : liste sèche en §0,
     justification ici. -->

## 10. Décisions tranchées / points ouverts

<!-- Pour chaque point non couvert par le contexte ou une décision déjà validée : soit une
     décision tranchée ici avec sa justification (ancrée dans l'existant), soit un point
     explicitement laissé ouvert pour arbitrage. Ne jamais trancher en silence. -->

## 11. Annexe — traçabilité code→règle

<!-- Table Section | Fichiers sources (legacy et/ou cible). -->

## 12. Documents liés

<!-- Cahiers des charges, autres specs, docs de référence. -->
