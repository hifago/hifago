---
id: specs-readme
titre: "Specs — fonctionnalités prêtes à coder, une par une"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: actif
maj: 2026-09-28
resume: >
  Conventions des specs de feature : ce qu'est une spec (une fonctionnalité précise, prête à
  coder), nommage, gabarit, les deux axes de statut. La liste des specs est dans docs/INDEX.md.
mots_cles: [specs, gabarit, feature, hifago, cahier des charges, prêt à coder, statut, convention]
repond_a:
  - "Qu'est-ce qu'une spec ici, et comment la nommer ?"
  - "Comment écrire une nouvelle spec de feature ?"
  - "Quelle est la différence entre une spec et un cahier des charges ?"
---

# Specs — fonctionnalités prêtes à coder

## Ce qu'est une spec ici

Une spec = **une fonctionnalité précise**, décrite jusqu'au niveau où elle est prête à coder :
parcours utilisateur, champs exacts, modèle de données, contrat d'API/RPC, cas limites, et les
points encore laissés au jugement de qui code. Elle décrit une feature du nouveau stack Hifago.

**Ce qu'une spec n'est pas :**
- Pas un cahier des charges de rôle entier (`docs/0X-cahier-des-charges-*.md` reste la
  vision globale d'un portail — client, socio, admin — validée section par section avec Jérôme).
  Une spec **raffine** une portion précise d'un cahier des charges déjà validé ; elle ne le
  contredit jamais, elle le rend actionnable.
- Pas un plan d'architecture transverse multi-features (`docs/04-architecture-cible.md` porte les
  décisions transverses).

## Convention

- **Avant de copier le gabarit** : suivre la checklist de clarification
  [`avant-la-spec.md`](avant-la-spec.md) — comment poser les bonnes questions à Jérôme pour que
  l'ambiguïté soit tranchée avant l'écriture, pas découverte en codant.
- **Nommage** : `NN-slug-kebab.md`, `NN` = ordre de création — jamais réordonné, jamais réutilisé
  même si une spec est un jour archivée.
- **Gabarit** : copier [`_modele.md`](_modele.md).
- **Statut** : deux axes distincts, à ne pas confondre (précisé le 2026-09-07, après que la
  spec 27 se soit heurtée au contrôle).
  - **Le frontmatter `statut` décrit l'état d'IMPLÉMENTATION**, et `npm run docs:check` en vérifie
    l'énumération : `brouillon | partiel | implemente | supprimee`. Une spec validée par Jérôme mais
    pas encore construite reste donc `brouillon` — écrire « validé par Jérôme le … » ici **échoue au
    contrôle**.
  - **L'état de VALIDATION vit dans la table interne « Sommaire et statut »**, où chaque section
    porte le sien : `brouillon` → `en relecture` → `✅ validé 2026-09-07`. Convention reprise de
    `docs/03-cahier-des-charges-admin.md`, où elle s'applique de la même façon.
  - Quand une spec est validée sans être construite, le dire aussi en une ligne sous le titre, pour
    qu'un lecteur qui voit `statut: brouillon` ne conclue pas qu'elle n'est pas arbitrée.
- **Enregistrement** : automatique — le hook pre-commit régénère `docs/INDEX.md` (la carte, avec la
  plage de la §0 de chaque spec) et `docs/ai-index.json` ; `npm run docs:check` le vérifie en CI.

## Sommaire

La liste des specs — statut, taille, plage de la §0 à lire — est **générée** dans
[`../INDEX.md`](../INDEX.md). Le sommaire écrit à la main qui vivait ici a été supprimé le
2026-09-28 : il doublait la carte et dérivait (mention de l'hôtel supprimé, statuts en retard).
