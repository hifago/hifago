---
paths:
  - "docs/marketing/**"
  - "com-dev/**"
---

# Documents marketing — chargée quand on touche `docs/marketing/` ou `com-dev/`

Décidé par Jérôme le 2026-11-12. L'invariant de placement est aussi dans `CLAUDE.md` §1, parce qu'un
document marketing peut naître n'importe où.

1. **Tout document marketing ou commercial va dans `docs/marketing/<piece>/`** : proposition à un
   partenaire ou un référent, dossier commercial, plaquette, présentation, campagne, guide co-signé,
   visuel de communication. Jamais dans `com-dev/` (réservé au suivi bêta-test et des tâches), jamais
   à la racine, jamais dans `apps/`.
2. Un sous-dossier par pièce, nommé en kebab-case (`propuesta-los-patios`), et une ligne pour lui dans
   le tableau de `docs/marketing/README.md` : destinataire, langue, état, ce qui reste à faire.
   Vérifié par `npm run docs:check` (CI) : un sous-dossier absent du tableau fait échouer le contrôle.
3. Ce qui est dit du produit se vérifie dans le code, le backlog ou sur hifago.co **le jour de la
   rédaction**. Une fonction annoncée « en ligne » qui ne l'est pas en prod va dans une rubrique
   « avant le lancement », jamais dans « ce qui marche » (précédent : le paiement par carte de la
   proposition Los Patios, refusé en prod au 2026-11-04).
4. Chiffres externes : source citée dans la pièce (titre, média, date). Aucun logo d'institution ni
   de partenaire sans son accord : il laisserait croire à un partenariat officiel.
5. Marque : lire les éléments dans `apps/web/public/brand/` par chemin relatif, jamais les copier ;
   l'illustration de la rue aux zócalos se cadre comme sur le héros du site
   (`apps/web/app/[locale]/(vitrine)/PortadaInicio.tsx`).

Ce que `docs:check` ne peut pas voir : qu'un document marketing ait été créé AILLEURS que dans
`docs/marketing/`. Ce contrôle-là reste humain (`CLAUDE.md` §11.20) — le signaler si on en trouve un.
