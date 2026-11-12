---
id: marketing-index
titre: "Marketing — documents commerciaux et de communication de Hifago"
theme: marketing
statut: vivant
langue: fr
maj: 2026-11-12
resume: >
  Point d'entrée du dossier docs/marketing/ : tout document commercial ou de communication de
  Hifago (proposition à un partenaire, dossier commercial, plaquette, présentation, campagne, guide
  co-signé) vit ici, un sous-dossier par pièce. Liste les pièces existantes et leur état.
mots_cles: [marketing, commercial, proposition, partenaire, referent, los patios, dossier, pdf]
repond_a:
  - "Où ranger un document marketing ou commercial ?"
  - "Où est la proposition faite à Los Patios ?"
  - "Quels documents commerciaux existent déjà ?"
---

# Marketing — documents commerciaux et de communication

> Règle : **tout document marketing ou commercial va ici**, jamais dans `com-dev/` ni ailleurs dans le
> dépôt (`.claude/rules/marketing.md`). Un sous-dossier par pièce, cité dans le tableau ci-dessous —
> `npm run docs:check` échoue sur un sous-dossier absent du tableau.

## Pièces

| Dossier | Pièce | Destinataire | Langue | État |
|---|---|---|---|---|
| [propuesta-los-patios/](propuesta-los-patios/) | Proposition d'alliance Hifago × Los Patios (7 pages A4) : 8 % de commission référent, arguments financiers et d'image, mécanique du QR, pilote de 8 semaines | Équipe commerciale de Los Patios (Medellín) | es | Rédigée le 2026-11-09, recadrage de la couverture le 2026-11-09. Avant la réunion : créer le code `LOSPATIOS` dans l'admin ; paiement par carte en prod à confirmer (encadré « Antes del piloto ») |

## Comment une pièce est faite

- Source `index.html` (charte Hifago : or `#ddae09`, marine `#132f61`, Anton + Poppins), PDF A4 généré
  à partir d'elle par Playwright + Edge, images propres à la pièce dans `img/`.
- Les éléments de marque (logos, illustration de la rue aux zócalos) sont lus dans
  `apps/web/public/brand/` par chemin relatif, jamais copiés.
- Tout chiffre externe est sourcé dans la pièce ; tout ce qui est dit du produit est vérifié dans le
  code ou sur hifago.co le jour de la rédaction (prix, nombre de prestataires, fonctionnalités).
