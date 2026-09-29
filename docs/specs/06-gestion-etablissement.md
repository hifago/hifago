---
id: specs-gestion-etablissement
titre: "Gestion d'un établissement — admin édite, partenaire propose (création et édition)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
revise:
  - "docs/02-cahier-des-charges-socio.md#3b"
  - "docs/02-cahier-des-charges-socio.md#3e"
maj: 2026-08-15
resume: >
  Comble le gap admin (présentation d'établissement éditable après création, décision §3c déjà
  validée mais jamais construite) et l'absence totale côté socio : un partenaire peut désormais
  proposer la création d'un établissement (premier ou supplémentaire) et l'édition du sien déjà
  rattaché, toujours via modération admin — jamais d'écriture directe. Symétrique au mécanisme déjà
  en place pour les photos (spec 04) et le contenu produit (product_proposals). Lève le point resté
  ouvert au cahier socio §3b et à la spec 05 §10.
mots_cles: [etablissement, edition, proposition, moderation, admin, socio, partner, hifago,
  establishment_proposals, update_establishment, create_establishment]
repond_a:
  - "Comment l'admin édite-t-il un établissement après sa création ?"
  - "Comment un partenaire propose-t-il la création ou l'édition de son établissement ?"
  - "Qui approuve une proposition d'établissement, et avec quelle RPC ?"
  - "Un partenaire déjà rattaché à un établissement peut-il en ajouter un second ?"
---

# Gestion d'un établissement

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`). **Feature n°30** (numéro de build
> tentatif — dernière feature numérotée : 29, `docs/specs/05-invitations-onboarding-dashboard-
> partenaire.md` ; la gestion d'images n'a délibérément pas pris de numéro).
>
> **Implémentée le 2026-08-15**, spec rédigée puis codée dans la même session, en un seul geste
> (backend → tests → front → vérification → gate `/hifago-review`), sans respecter le séquencement
> par commits distincts envisagé en §4 (livré d'un bloc, la dépendance ordonnée restant valide si
> besoin de le refaire). Fichiers réels en annexe §11. Voir « Écarts connus » (fin de ce document)
> pour deux points d'environnement rencontrés en vérifiant, sans lien avec cette feature.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (API/RPC, modèle de données, invariants, cas limites — pour coder) | implémenté |
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écran(s) | implémenté |
| 6-9 | *(fusionnées dans 0 — Modèle de données, Contrat API/RPC, Règles et invariants, Cas limites)* | implémenté |
| 10 | Décisions tranchées / points ouverts | implémenté |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

> Rétrofit du 2026-08-15 : cette section 0 a été ajoutée après coup (spec déjà implémentée) pour
> valider le format du nouveau gabarit `_modele.md`. Copie sèche des faits déjà établis en
> §6-9 ci-dessous — aucun contenu nouveau, aucune reformulation du raisonnement.

### Endpoints / RPC

Squelette de sécurité : `hifago/docs/05-reference-technique.md`. Pas de squelette anti-survente
(`hifago/CLAUDE.md` §4) — aucun compteur de capacité limitée touché ici.

| RPC | Rôle | Sécurité | Signature |
|---|---|---|---|
| `update_establishment` | admin | `security invoker` | `(p_establishment_id uuid, p_name jsonb, p_description jsonb=null, p_address text=null, p_lat float8=null, p_lon float8=null, p_operated_directly bool=false, p_note text=null) → jsonb` |
| `submit_establishment_creation_proposal` | socio | `security definer`, `search_path=''` | `(p_payload jsonb) → jsonb` — payload `{name jsonb, description? jsonb, address? text, lat? float8, lon? float8}` |
| `submit_establishment_edit_proposal` | socio | `security definer` | `(p_establishment_id uuid, p_payload jsonb) → jsonb` |
| `withdraw_establishment_proposal` | socio | `security definer` | `(p_proposal_id uuid) → jsonb` |
| `moderate_establishment_proposal` | admin | `security definer` | `(p_proposal_id uuid, p_decision text, p_expected_version int, p_corrected_payload jsonb=null, p_rejection_reason text=null) → jsonb` — `select...for update` + verrou optimiste `version` |

### Modèle de données (delta)

| Table/colonne | Statut |
|---|---|
| `establishments` (`name`, `description`, `address`, `lat`, `lon`, `operated_directly`) | Déjà existantes, réutilisées telles quelles — seule l'éditabilité post-création manquait. |
| `establishments.status` | Existante, non touchée — hors périmètre. |
| `establishment_proposals` *(nouvelle, RPC-only)* | Miroir `product_proposals` : `id`, `establishment_id` (nullable pour `kind='create'` non approuvée), `partner_id`, `submitted_by`, `kind` (`create`\|`edit`), `status` (`pending`\|`approved`\|`rejected`\|`withdrawn`), `payload jsonb` (jamais `operated_directly`), `rejection_reason`, `version int` (verrou optimiste), `reviewed_by`, `reviewed_at`, `created_at`, `updated_at`. RLS : `select_own` (par `partner_id`), `select_admin`. Index `(partner_id,status)`, `(establishment_id,status)`. |

Migration : `hifago/supabase/migrations/20260815170000_gestion_etablissement.sql`.

### Invariants

- Créer un établissement : admin en écriture directe (`create_establishment`, inchangée) ; socio propose seulement (`submit_establishment_creation_proposal`), jamais de publication directe.
- Éditer un établissement : admin en écriture directe (`update_establishment`, nouvelle) ; socio propose seulement (`submit_establishment_edit_proposal`), uniquement sur son propre établissement avec capacité `operator` active.
- `operated_directly` jamais dans le payload proposable par le socio — filtré côté RPC, forcé à `false` à la création, relu depuis la ligne existante et repassé tel quel à l'édition (sinon une approbation écraserait silencieusement ce champ).
- `moderate_establishment_proposal` est le seul chemin qui publie une proposition socio ; appelle en interne `create_establishment`/`update_establishment`, jamais de logique dupliquée.
- Toute écriture admin est auditée nominativement (`log_admin_action`).
- Rattachement établissement↔partenaire reste exclusivement via `create_establishment`/`transfer_establishment` (spec 03) — aucun second chemin d'écriture sur `establishments.partner_id` ici.
- Un seul mécanisme de proposition socio pour « premier établissement » et « établissement supplémentaire » — `create_establishment` gère déjà les deux cas identiquement.
- Garde-fou de capacité différent create/edit : `submit_establishment_creation_proposal` ne vérifie aucune capacité `operator` préexistante ; `submit_establishment_edit_proposal` exige `has_capability(auth.uid(), 'operator', p_establishment_id)` active.

### Cas limites

- Proposition d'édition sur un établissement déjà transféré → `has_capability` échoue → `capability_suspended` (déjà correct sans code supplémentaire).
- Le gap `transfer_establishment` × `partner_capabilities` (l'ancien partenaire garde sa ligne `operator`, le nouveau n'en a aucune) empêche le nouveau propriétaire de proposer une édition tant que non corrigé — documenté, **hors périmètre** de cette spec (§9/§10).
- Double proposition `kind='edit'` en attente sur le même établissement → autorisé, plafonné seulement par le compteur global (10).
- Rejet puis re-proposition → aucune restriction (le plafond ne compte que `status='pending'`).
- `kind='create'` en modération → l'UI affiche un espace réservé explicite, jamais un tableau vide silencieux.
- Admin édite pendant qu'une proposition `edit` est en attente → dernière écriture gagne côté `establishments` ; à l'approbation, le payload corrigé par l'admin au moment de la modération prime toujours.

### Fichiers touchés

- `hifago/supabase/migrations/20260815170000_gestion_etablissement.sql` (migration : table, RLS, 5 RPC)
- `hifago/packages/supabase/src/database.types.ts` (types régénérés)
- `hifago/apps/admin/app/admin/establishments/[id]/EstablishmentEditBlock.tsx` (nouveau) + `.../page.tsx` (modifié)
- `hifago/apps/admin/app/partner/(app)/establishment/{layout.tsx,page.tsx,PendingCreationBanner.tsx,new/{page.tsx,NewEstablishmentProposalForm.tsx},[id]/edit/{page.tsx,EditEstablishmentProposalForm.tsx}}` (nouveau sous-arbre)
- `hifago/apps/admin/app/partner/(app)/PartnerNav.tsx` (supprimé le 2026-08-20 — la nav socio vit dans `apps/admin/app/partner/(app)/PartnerAppNav.tsx`), `.../page.tsx` (modifiés)
- `hifago/apps/admin/app/admin/proposals/{page.tsx,ProposalsTable.tsx,[id]/page.tsx}` (modifiés), `[id]/ModerateEstablishmentProposalForm.tsx` (nouveau)
- `hifago/apps/admin/e2e/admin-establishment-edit.spec.ts`, `partner-establishment-proposals.spec.ts` (tests)

Détail complet, justification de chaque décision et traçabilité code→règle : §1-12 ci-dessous.

## 1. Contexte et problème

Jérôme a demandé une spec sur la gestion d'un établissement au sens complet — pas seulement sa
création (déjà couverte par `docs/specs/03-admin-creation-etablissement.md`) : l'admin doit pouvoir
créer un établissement, le rattacher à un partenaire, **et aussi l'éditer** ; le partenaire rattaché
doit **lui aussi** pouvoir créer un établissement et éditer ses informations. Trois constats
distincts, établis par recherche exhaustive dans le code (pas par déduction), motivent cette spec.

### Bloc A — gap admin : une décision déjà validée, jamais construite

`hifago/docs/03-cahier-des-charges-admin.md` §3c (« Gestion directe du catalogue », validé le
2026-08-11) dit explicitement :

> « dans la cible, toute la présentation d'un établissement s'édite depuis l'admin — plus aucun
> champ de présentation ne doit nécessiter un déploiement pour changer »

Le code réel ne le fait pas. `hifago/apps/admin/app/admin/establishments/[id]/page.tsx` n'affiche
que `name` en lecture seule (titre de page) et un bloc d'édition de photos
(`EstablishmentPhotosBlock.tsx`, livré par `docs/specs/04-gestion-images.md`). Les champs `name`,
`description`, `address`, `lat`, `lon`, `operated_directly` sont écrits une seule fois, à la
création, par `create_establishment` (`hifago/supabase/migrations/20260815110000_gestion_images.sql`)
— et plus jamais modifiables ensuite : aucune RPC `update_establishment` n'existe, aucun écran ne
l'exploite. La policy `establishments_write_admin` (`for all using (is_admin())`) autoriserait
techniquement une écriture directe, mais rien ne l'utilise. C'est un pur écart entre une décision
déjà actée et le code livré, pas une nouvelle hypothèse.

### Bloc B — absence totale côté socio, nuancée par une décision nouvelle

Aucun écran, route ou RPC ne permet à un partenaire de créer ou d'éditer sa fiche établissement,
dans `hifago/apps/admin/app/partner/` (recherche exhaustive, aucune occurrence). Ce n'était même pas
envisagé jusqu'ici : le legacy pose le principe explicitement — `docs/2-reference/02-app-partner.md:461-466`
: *« un socio ne crée jamais un hébergement : un lieu de séjour se déclare dans le registre des
propriétés, pas depuis un portail »* — et hifago hérite du même principe pour tout contenu
public : un partenaire ne publie jamais directement, il propose (`submit_product_proposal`,
`submit_photos_proposal`, invariant cahier socio §3f cité en spec 04 : *« un prestataire n'introduit
jamais de contenu non modéré dans le catalogue public »*). Les décisions 1/2 ci-dessous **ne
renversent pas** ce principe — elles l'étendent à l'établissement, toujours en mode proposition
modérée, jamais en écriture directe.

### Bloc C — un point resté ouvert, maintenant tranché

Le cahier socio §3b (« Invitations et onboarding ») laisse un point explicitement non tranché :

> « Ajouter un établissement supplémentaire à un partenaire déjà inscrit — le parcours actuel ne
> couvre que le rattachement à l'inscription. Avec le multi-établissements, un partenaire existant
> doit pouvoir en ajouter un autre depuis son compte, pas seulement via une nouvelle invitation.
> Détail à trancher au chiffrage : self-service (comme la demande d'ouverture prestataire) ou
> toujours via l'admin. »

`docs/specs/05-invitations-onboarding-dashboard-partenaire.md` §2/§10 confirme que ce point restait
ouvert : *« Ajouter un établissement supplémentaire [...] le cahier des charges lui-même les laisse
"à trancher au chiffrage", pas tranchés ici »*, et sa §5.1 affiche un état purement informatif
(« en attente de rattachement établissement », *« pas d'action self-service — le rattachement reste
admin-only »*).

**Décisions de Jérôme (à ne pas rouvrir) :**

1. **Création d'établissement côté partenaire = proposition modérée**, jamais self-service direct
   ni jamais interdite. Nouveau mécanisme, symétrique à `submit_photos_proposal`/`product_proposals`
   (spec 04) : le partenaire soumet une demande (nom + présentation), l'admin approuve avant que
   l'établissement existe réellement dans le registre `establishments`.
2. **Édition d'un établissement déjà rattaché côté partenaire = proposition modérée** également,
   même logique — jamais d'écriture directe du partenaire sur les champs de présentation de son
   établissement.

Ces deux décisions tranchent le point resté ouvert au cahier socio §3b et à la spec 05 §10.

### Découverte qui simplifie la portée

`create_establishment` (RPC déjà existante) gère déjà, à l'identique, le tout premier établissement
d'un partenaire et un établissement supplémentaire — vérifié dans le code :

```sql
update public.partner_capabilities
   set establishment_id = v_establishment_id
 where partner_id = p_partner_id and role = 'operator' and establishment_id is null;

if not found then
  insert into public.partner_capabilities (partner_id, establishment_id, role, source, status)
  values (p_partner_id, v_establishment_id, 'operator', 'admin', 'onboarding');
end if;
```

(`hifago/supabase/migrations/20260815110000_gestion_images.sql:533-542`) — si une capacité
`operator` « en attente » existe (`establishment_id is null`, posée par `consume_partner_invitation`
à l'inscription), elle est rattachée ; sinon une nouvelle ligne est créée. **Un seul mécanisme de
proposition socio suffit donc pour les deux cas** (premier établissement ou établissement
supplémentaire), sans distinction de code — cette spec ne construit pas deux parcours différents.

### Découverte annexe — dette de documentation préexistante (sans lien avec le fond)

`docs/specs/05-invitations-onboarding-dashboard-partenaire.md` a son frontmatter à
`statut: brouillon` et sa §11 « à compléter une fois l'implémentation terminée », alors que la
feature est en réalité déjà livrée : `hifago/apps/admin/app/partner/(app)/page.tsx` (dashboard),
`hifago/apps/admin/app/admin/invitations/` (liste + révocation, `RevokeInvitationButton.tsx`) et la
migration `hifago/supabase/migrations/20260815160000_revoke_partner_invitation_rpc.sql` existent
tous. Corrigé au passage en §10, puisque cette spec 06 doit de toute façon toucher
`(app)/page.tsx`.

## 2. Portée

**In** :
- RPC `update_establishment` (admin, écriture directe auditée) + bloc d'édition dans l'écran
  `/admin/establishments/[id]`.
- RPC `submit_establishment_creation_proposal`, `submit_establishment_edit_proposal`,
  `withdraw_establishment_proposal` (socio) + écrans `/partner/(app)/establishment/*`.
- RPC `moderate_establishment_proposal` (admin) + extension de l'écran de modération existant
  (`/admin/proposals`) pour ce nouveau type de proposition.
- Table `establishment_proposals` (nouvelle, RPC-only).
- Petit correctif fonctionnel de `hifago/apps/admin/app/partner/(app)/page.tsx` (dashboard, livré
  par la spec 05) : l'état « en attente de rattachement établissement » devient actionnable (lien
  vers `/partner/establishment/new`) au lieu de purement informatif.
- Correctif de cohérence documentaire de `docs/specs/05-invitations-onboarding-dashboard-
  partenaire.md` (statut réel + §2/§5.1/§5.6/§10, cf. §10 ci-dessous) — housekeeping découvert en
  explorant cette spec, sans lien avec son fond.

**Out, explicitement renvoyé ailleurs :**
- **Champ `status`/archivage d'un établissement** — colonne déjà en base (`active`/`archived`),
  jamais écrite par aucun écran ni RPC aujourd'hui. Aucune décision validée n'exige de l'exposer
  maintenant, et les effets de cascade sur les produits d'un établissement archivé n'ont pas été
  analysés — laissé ouvert (§10).
- **`transfer_establishment` / rattachement établissement↔partenaire** — reste exclusivement admin
  (spec 03 §3, inchangé). Le partenaire ne choisit jamais à qui appartient son établissement.
- **Galerie de photos** — entièrement couverte par la spec 04 (établissement = 100 % admin, aucune
  policy `delete_own` pour le socio, décision volontaire documentée dans
  `20260815110000_gestion_images.sql:72-75`) — non retouchée ici. Cette spec porte sur les champs de
  présentation texte/adresse, pas sur les photos.
- **Tags de catégorisation, nombre de chambres/capacité, horaires check-in/checkout, équipements
  structurés, slug public, devise** — déjà explicitement écartés par `docs/specs/03-admin-creation-
  etablissement.md` §2/§10 (proposés puis non retenus, ou dépendants d'une fiche publique
  établissement qui n'existe pas encore) — non rouverts ici.
- **OAuth Google « en un clic », multi-utilisateur par compte organisation** — hors périmètre,
  inchangé depuis `docs/specs/05-invitations-onboarding-dashboard-partenaire.md` §10.
- **Le gap `transfer_establishment` ne touchant jamais `partner_capabilities`** (constaté en
  explorant cette spec, cf. §9) — documenté comme cas limite connu, **explicitement hors périmètre**
  : le transfert est un geste admin rare, déjà marqué comme dette dans son propre code ; corriger ce
  point élargirait le périmètre sans nécessité pour livrer la feature demandée.

## 3. Décisions retenues

Ne pas rouvrir — les deux décisions de Jérôme (§1) :
1. Création d'établissement côté partenaire = proposition modérée.
2. Édition d'un établissement déjà rattaché côté partenaire = proposition modérée.

Décisions de construction propres à cette spec, chacune justifiée :

- **Table dédiée `establishment_proposals`, pas de réutilisation de `product_proposals`.**
  `product_proposals.product_id` est `not null`
  (`hifago/supabase/migrations/20260813234500_product_proposals.sql:11`) — une proposition
  `kind='create'` d'établissement n'a par construction aucun `product_id`/`establishment_id` au
  moment de la soumission (l'établissement n'existe pas encore). Forcer cette colonne à nullable sur
  `product_proposals` pour accommoder un cas qui ne concerne jamais les produits romprait une
  contrainte déjà exploitée ailleurs. Table séparée, même schéma d'esprit (§6).
- **Deux RPC de soumission distinctes** (`submit_establishment_creation_proposal` /
  `submit_establishment_edit_proposal`), pas une seule paramétrée par un `p_kind`. Reprend le
  précédent déjà choisi dans le code (`submit_product_proposal` vs `submit_photos_proposal`, deux
  RPC distinctes pour deux jeux de garde-fous différents) plutôt que d'inventer un nouveau patron —
  create n'a pas d'ownership à vérifier, edit si (§7).
- **`moderate_establishment_proposal` appelle en interne `create_establishment`/
  `update_establishment`**, jamais de logique dupliquée. Un seul point d'écriture Postgres pour
  « insérer/mettre à jour un établissement », que ce soit un geste admin direct ou l'issue d'une
  approbation — jamais deux implémentations de la même opération qui pourraient diverger.
  `SECURITY DEFINER` n'affecte pas `auth.uid()`, donc le garde-fou `is_admin()` interne de
  `create_establishment` reste correct même appelé depuis `moderate_establishment_proposal`.
- **`update_establishment` en `security invoker`, pas `security definer`.** Reprend exactement le
  raisonnement déjà écrit dans le code pour `transfer_establishment`
  (`hifago/supabase/migrations/20260814150000_partner_registry_rpc.sql:106-111`) : `establishments`
  est RLS-directe admin (`establishments_write_admin`), un admin y a déjà un accès direct.
  Contrairement à `create_establishment` (qui doit aussi écrire dans `partner_capabilities`,
  RPC-only, donc a besoin de `definer`), `update_establishment` ne touche que `establishments` +
  `log_admin_action` (lui-même `definer`, auto-suffisant).
- **`operated_directly` jamais dans le payload proposable par le socio.** C'est une classification
  métier/plateforme (« exclu des KPIs de performance externe », cahier admin §3e), pas un champ de
  présentation — même logique que l'exclusion déjà codée de `sellable`/commission/mapping PMS dans
  `submit_product_proposal` (cahier socio §3d). Un établissement créé via proposition socio a
  toujours `operated_directly = false`, imposé côté RPC, jamais lu depuis le payload. **Point
  d'implémentation critique** : `moderate_establishment_proposal` doit relire `operated_directly`
  depuis la ligne `establishments` existante et le repasser tel quel à `update_establishment`
  (remplacement complet, pas un patch partiel) — sinon une approbation d'édition écraserait
  silencieusement ce champ à sa valeur par défaut (`false`), corrompant une donnée jamais proposée
  par le socio.
- **Coexistence, pas remplacement, du chemin admin existant** (`/admin/establishments/new`, badge
  « Falta establecimiento » de la spec 05 §5.3). Il devient le filet de sécurité si le partenaire ne
  fait pas sa demande lui-même (ex : partenaire onboardé hors-ligne, par WhatsApp, sans jamais se
  connecter au dashboard). Les deux chemins convergent sur la même RPC `create_establishment`,
  jamais dupliqués.
- **Garde-fou de capacité différent entre create et edit.**
  `submit_establishment_creation_proposal` ne vérifie **aucune** capacité `operator` préexistante
  (miroir de la permissivité déjà présente dans `create_establishment` côté admin — un partenaire
  sans aucune capacité operator peut recevoir un premier établissement). `submit_establishment_edit_
  proposal` vérifie `has_capability(auth.uid(), 'operator', p_establishment_id)`, qui exige un
  statut `active` — donc un partenaire dont la capacité vient tout juste d'être créée par
  l'approbation d'une proposition de création (statut `onboarding` par défaut) **ne peut pas encore
  proposer d'édition** tant que l'admin n'a pas activé sa capacité (`set_capability_status`).
  Invariant déjà en vigueur ailleurs (`submit_product_proposal`, `submit_photos_proposal`,
  `product_media_delete_own`), pas une restriction nouvelle inventée ici — documenté en cas limite
  (§9), pas un bug.

## 4. Parcours cible

**4.1 — Admin édite un établissement existant.** Ouvre `/admin/establishments/[id]` → nouveau bloc
« Editar establecimiento » (à côté du bloc photos existant, pré-rempli avec les valeurs actuelles) →
modifie nom/description/adresse/lat-lon/opéré directement → soumission → `update_establishment` →
confirmation, valeurs affichées mises à jour sans reload complet.

**4.2 — Partenaire propose la création d'un établissement.** Depuis `/partner` (dashboard, spec 05)
ou `/partner/establishment` (nouvelle liste) → clique « Proponer un nuevo establecimiento » →
`/partner/establishment/new` → remplit nom (requis)/description/adresse (widget Google Places
réutilisé)/lat/lon → soumission → `submit_establishment_creation_proposal` → message « en attente de
revisión » + apparition dans la liste avec statut pending et bouton « Retirar ». Couvre
indifféremment le tout premier établissement (capacité `operator` en attente) et un établissement
supplémentaire (capacité déjà active sur un autre établissement) — même écran, même RPC (§1).

**4.3 — Partenaire propose une édition de son établissement déjà rattaché.** Depuis
`/partner/establishment` (liste, un item par établissement dont il a la capacité `operator` active)
→ clique un établissement → `/partner/establishment/[id]/edit` (pré-rempli avec la fiche complète
actuelle) → modifie un ou plusieurs champs → soumission → `submit_establishment_edit_proposal` →
apparaît en modération, la fiche publiée garde ses valeurs actuelles jusqu'à approbation.

**4.4 — Admin modère une proposition (création ou édition).** `/admin/proposals` (liste étendue,
fusion `product_proposals` ∪ `establishment_proposals` triée par date de création) → clique une
ligne établissement → `/admin/proposals/[id]?entity=establishment` → nouveau composant
`ModerateEstablishmentProposalForm.tsx` (valeur actuelle vs proposée en deux colonnes ; pour
`kind='create'`, colonne « actuelle » affiche un espace réservé « — nuevo establecimiento — ») →
corrige si besoin → Approuver (`moderate_establishment_proposal`, `p_decision='approve'`) ou
Rechazar (motif obligatoire).

**Séquencement d'implémentation recommandé** : 4.1 (admin, `update_establishment`) n'a aucune
dépendance sur 4.2-4.4 et peut être livré seul en premier. 4.2-4.3 (table + RPC socio + écrans
partenaire) ensuite. 4.4 (moderate + extension `/admin/proposals`) en dernier, car il consomme les
RPC déjà livrées (`create_establishment`, `update_establishment`) par réutilisation directe.

## 5. Écran(s)

**5.1 Admin — nouveau bloc d'édition** (`hifago/apps/admin/app/admin/establishments/[id]/`) :
nouveau composant `EstablishmentEditBlock.tsx` (Client Component, pattern `<fieldset>` repris de
`NewEstablishmentForm.tsx`), inséré dans `page.tsx` **avant** `EstablishmentPhotosBlock`. Champs :
Nombre, Descripción (switcher ES/EN identique à la création), Dirección (réutilise
`mountAddressAutocomplete`/`address-autocomplete.ts`, déjà local à `apps/admin`), lat/lon, case
« Operado directamente ». Si une proposition `kind='edit'` `status='pending'` existe pour cet
établissement, bandeau « Hay una propuesta de edición pendiente » avec lien vers
`/admin/proposals/[id]?entity=establishment` — simple requête `select`, pas de nouvelle RPC — pour
que l'admin ne modifie pas en aveugle pendant qu'une proposition attend.

**5.2 Partenaire — nouveau sous-arbre** `hifago/apps/admin/app/partner/(app)/establishment/` :
- `page.tsx` (Server Component) : liste des établissements du partenaire (`establishments` où
  `partner_id = partner_id_for_account(auth.uid())`, RLS `establishments_select` déjà suffisante), +
  pour chacun un badge si une proposition `edit` est en attente ; bouton persistant « Proponer un
  nuevo establecimiento » (toujours visible, §2/§3) ; si une proposition `create` `pending` existe
  pour ce partenaire, bandeau « Propuesta de creación pendiente » + bouton Retirar
  (`withdraw_establishment_proposal`).
- `new/page.tsx` + `NewEstablishmentProposalForm.tsx` (Client Component) : mêmes champs que 5.1 sans
  `operated_directly` (jamais proposable par le socio, §3) ; soumet
  `submit_establishment_creation_proposal`.
- `[id]/edit/page.tsx` + `EditEstablishmentProposalForm.tsx` : pré-rempli avec la fiche courante
  (fetch server-side via RLS), même pattern « pending-proposal + bouton Retirar » que
  `EditProposalForm.tsx` ; soumet `submit_establishment_edit_proposal`.
- `PartnerNav.tsx` : ajouter `{ href: "/partner/establishment", label: "Mi establecimiento" }` à
  `NAV_ITEMS`.
- `(app)/page.tsx` (dashboard, livré spec 05) : le bloc actuel affichant « en attente de
  rattachement établissement » pour une capacité `operator` avec `establishment_id null` devient un
  lien actionnable vers `/partner/establishment/new` — seul changement fonctionnel requis sur ce
  fichier déjà livré.

**5.3 Admin — extension de `/admin/proposals`** :
- `page.tsx` : deux requêtes (`product_proposals` inchangée + nouvelle sur `establishment_proposals`
  avec `status='pending'`), fusion + tri par `created_at` côté serveur avant de passer à
  `ProposalsTable`.
- `ProposalsTable.tsx` : type de ligne étendu en union discriminée (`entityType: 'product' |
  'establishment'`), colonne « Tipo » affiche `Creación`/`Edición` pour une ligne établissement (au
  lieu de `Contenido`/`Fotos`), lien vers `/admin/proposals/[id]?entity=establishment`.
- `[id]/page.tsx` : lit `searchParams.entity`, requête `establishment_proposals` si
  `entity === "establishment"` (sinon comportement actuel inchangé), rend le nouveau
  `ModerateEstablishmentProposalForm.tsx`.
- Nouveau `ModerateEstablishmentProposalForm.tsx` (mirroring `ModerateProposalForm.tsx`) : deux
  colonnes valeur actuelle/proposée (name/description/address/lat/lon), colonne « actuelle »
  vide/placeholder pour `kind='create'` ; boutons Aprobar/Rechazar → `moderate_establishment_proposal`.

## 6. Modèle de données

| Table/colonne | Statut |
|---|---|
| `establishments` (`name`, `description`, `address`, `lat`, `lon`, `operated_directly`) | Déjà supportées, réutilisées telles quelles — seule leur **éditabilité post-création** manque (RPC §7). |
| `establishments.status` | Existante, non touchée — hors périmètre (§2/§10). |
| `establishment_proposals` *(nouvelle)* | RPC-only, miroir de `product_proposals` avec adaptation pour le cas `kind='create'` (établissement pas encore existant). |

```sql
create table establishment_proposals (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid references establishments(id),   -- null tant que kind='create' non approuvée
  partner_id uuid not null references partners(id),
  submitted_by uuid not null references partner_accounts(id),
  kind text not null check (kind in ('create', 'edit')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  payload jsonb not null,          -- {name, description?, address?, lat?, lon?} — jamais operated_directly
  rejection_reason text,
  version int not null default 1,  -- verrou optimiste, même patron que product_proposals
  reviewed_by uuid references partner_accounts(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- establishment_id nullable UNIQUEMENT pour une création pas encore approuvée ; back-fillé au
  -- moment de l'approbation (moderate_establishment_proposal, §7) — jamais nul après approbation.
  constraint establishment_proposals_scope check (
    (kind = 'edit' and establishment_id is not null)
    or (kind = 'create' and establishment_id is null and status <> 'approved')
    or (kind = 'create' and establishment_id is not null and status = 'approved')
  )
);

-- Pas de GRANT explicite : couverte par ALTER DEFAULT PRIVILEGES (20260813163456_identity_rls.sql).
alter table establishment_proposals enable row level security;
revoke insert, update, delete on establishment_proposals from authenticated, anon;

create policy establishment_proposals_select_own on establishment_proposals
  for select using (partner_id = (select partner_id_for_account(auth.uid())));
create policy establishment_proposals_select_admin on establishment_proposals
  for select using ((select is_admin(auth.uid())));

create index establishment_proposals_partner_status_idx
  on establishment_proposals(partner_id, status);
create index establishment_proposals_establishment_status_idx
  on establishment_proposals(establishment_id, status) where establishment_id is not null;
```

Migration livrée : `hifago/supabase/migrations/20260815170000_gestion_etablissement.sql`.

**Classification RLS/RPC-only** (checklist `hifago/CLAUDE.md` §3) : `establishment_proposals` =
RPC-only (écriture cross-identité auditable, l'admin doit voir toutes les propositions, verrou
optimiste sur l'approbation) ; `establishments` reste RLS-directe admin, inchangée par cette spec.

## 7. Contrat API/RPC

Squelette de sécurité repris de `hifago/docs/05-reference-technique.md`, identique aux RPC
admin/socio voisines — pas de squelette anti-survente (`hifago/CLAUDE.md` §4), aucun compteur de
capacité limitée touché ici (même calibrage que `create_establishment`/`submit_product_proposal`).

**7.1 — `update_establishment` (admin, `security invoker`)**

```sql
update_establishment(
  p_establishment_id uuid,
  p_name jsonb,
  p_description jsonb default null,
  p_address text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_operated_directly boolean default false,
  p_note text default null
) returns jsonb
```

Corps : capture l'avant-état (`select * into v_before from establishments where id =
p_establishment_id`) → `update establishments set ... where id = p_establishment_id` → `if not found
then raise exception` (RLS refuse silencieusement si non-admin, même idiome que
`transfer_establishment`) → `perform log_admin_action('establishment.update', 'establishments',
p_establishment_id, to_jsonb(v_before), jsonb_build_object(...), p_note)` → `return
jsonb_build_object('ok', true)`.

**7.2 — `submit_establishment_creation_proposal` (socio, `security definer`, `set search_path=''`)**

```sql
submit_establishment_creation_proposal(p_payload jsonb) returns jsonb
-- p_payload: {name: jsonb, description?: jsonb, address?: text, lat?: double precision, lon?: double precision}
```

Garde-fous, dans l'ordre : non authentifié → `not_authenticated` ; pas de partenaire résolu →
`not_a_partner` ; `p_payload->'name'->>'es'` vide → `name_required` ; **plafond dédié : au plus une
proposition `kind='create'` `pending` par partenaire** (`pending_creation_exists`) — distinct du
plafond générique de 10, justifié par le fait qu'une création est une action rare/lourde (empêche un
double-clic de générer deux fiches fantômes pour le même lieu). Payload filtré explicitement
(whitelist `name`/`description`/`address`/`lat`/`lon`, jamais `operated_directly`).

**7.3 — `submit_establishment_edit_proposal` (socio, `security definer`)**

```sql
submit_establishment_edit_proposal(p_establishment_id uuid, p_payload jsonb) returns jsonb
```

Garde-fous, dans l'ordre : non authentifié → `not_authenticated` ; établissement introuvable ou non
rattaché → `establishment_not_found` (réponse générique, jamais de fuite d'existence d'un
établissement d'un tiers) ; `has_capability(auth.uid(), 'operator', p_establishment_id)` faux →
`capability_suspended` ; validation nom ; plafond générique **10** propositions `pending` (même
valeur littérale que `submit_product_proposal`), compté séparément sur `establishment_proposals`
(jamais mélangé avec `product_proposals`).

**7.4 — `withdraw_establishment_proposal` (socio, `security definer`)**

```sql
withdraw_establishment_proposal(p_proposal_id uuid) returns jsonb
```

Copie fidèle de `withdraw_product_proposal` : vérifie l'ownership (`partner_id =
partner_id_for_account(auth.uid())`) et `status = 'pending'` → passe à `withdrawn`.

**7.5 — `moderate_establishment_proposal` (admin, `security definer`)**

```sql
moderate_establishment_proposal(
  p_proposal_id uuid,
  p_decision text,                 -- 'approve' | 'reject'
  p_expected_version int,
  p_corrected_payload jsonb default null,
  p_rejection_reason text default null
) returns jsonb
```

`select ... for update` + verrou optimiste `version` (copie exacte du patron
`moderate_product_proposal`) → branche sur `v_proposal.kind` :
- `kind='create'` : construit `v_final_payload` (`p_corrected_payload` si fourni, sinon
  `v_proposal.payload`), appelle `select create_establishment(v_proposal.partner_id,
  v_final_payload->'name', ..., false) into v_new_establishment_id` (réutilisation directe,
  `operated_directly` forcé à `false`), puis `update establishment_proposals set status='approved',
  establishment_id = v_new_establishment_id, ...`.
- `kind='edit'` : appelle `perform update_establishment(v_proposal.establishment_id,
  v_final_payload->'name', ..., (select operated_directly from establishments where id =
  v_proposal.establishment_id))` — `operated_directly` relu depuis la ligne existante et repassé tel
  quel (voir §3, point d'implémentation critique).
- `reject` : identique au patron existant (`p_rejection_reason` obligatoire, `log_admin_action
  ('establishment_proposal.reject', ...)`).

## 8. Règles et invariants

| Action | Admin | Socio |
|---|---|---|
| Créer un établissement | Écriture directe (`create_establishment`, spec 03, inchangée) | Propose seulement (`submit_establishment_creation_proposal`), jamais de publication directe |
| Éditer un établissement (nom/description/adresse/coords) | Écriture directe (`update_establishment`, nouvelle) | Propose seulement (`submit_establishment_edit_proposal`), uniquement sur son propre établissement rattaché avec capacité `operator` active |
| Éditer `operated_directly` | Écriture directe admin uniquement | Jamais proposable — filtré côté RPC |
| Approuver/rejeter une proposition établissement | Seul chemin qui publie une proposition socio (`moderate_establishment_proposal`) | — |
| Retirer sa propre proposition en attente | — | `withdraw_establishment_proposal` |

- Invariant transverse repris tel quel : *« un partenaire n'introduit jamais de contenu non
  modéré »* (cahier socio §3f, déjà cité spec 04) s'applique désormais aussi à l'entité
  établissement, pas seulement aux produits/photos.
- Toute écriture admin est auditée nominativement (`log_admin_action`) — `update_establishment`,
  `create_establishment` (via réutilisation) et les deux branches de
  `moderate_establishment_proposal` s'y conforment.
- Le rattachement établissement↔partenaire reste exclusivement via `create_establishment`/
  `transfer_establishment` (spec 03) — cette spec n'ajoute aucun deuxième chemin d'écriture sur
  `establishments.partner_id`.
- `establishments_write_admin` (RLS directe) reste la défense en profondeur derrière
  `update_establishment` — même raisonnement déjà écrit pour `add_catalog_media` (spec 04) : rien ne
  l'exige techniquement, la policy reste en défense en profondeur.

## 9. Cas limites

- **Proposition d'édition sur un établissement déjà transféré à un autre partenaire**
  (`transfer_establishment` entre-temps) → `has_capability` échoue (le partenaire d'origine n'a plus
  de capacité active pour cet établissement), `capability_suspended` retourné — comportement déjà
  correct sans code supplémentaire, documenté ici plutôt que supposé.
- **Le gap `transfer_establishment` ne touchant jamais `partner_capabilities`** : après un
  transfert, l'ancien partenaire garde sa ligne `operator` pointée sur l'établissement transféré
  (jamais retirée) et le nouveau partenaire n'en a aucune. Conséquence directe pour cette spec : le
  nouveau propriétaire ne peut jamais proposer d'édition sur l'établissement qu'il vient de recevoir
  (`has_capability` échoue, aucune ligne pour lui) tant que ce gap n'est pas corrigé. **Décision** :
  documenté comme cas limite connu et explicitement hors périmètre (§2) — le transfert est un geste
  admin rarissime, déjà marqué comme dette dans le code de `transfer_establishment` lui-même ; à
  trancher séparément si le besoin se présente (§10).
- **Double proposition `kind='edit'` en attente sur le même établissement** → autorisé
  structurellement (pas de dédoublonnage, même comportement hérité que `submit_product_proposal`
  aujourd'hui), plafonné seulement par le compteur global (10). Comportement assumé, pas un oubli.
- **Rejet puis re-proposition** → aucune restriction, le partenaire peut soumettre une nouvelle
  proposition dès que la précédente est `rejected` (le plafond ne compte que `status='pending'`).
- **`kind='create'` sur l'écran de modération, pas de « valeur actuelle »** → l'UI affiche un espace
  réservé explicite (« — nuevo establecimiento — »), jamais un tableau vide silencieux qui laisserait
  croire à un bug.
- **Admin édite l'établissement pendant qu'une proposition `edit` est en attente** → dernière
  écriture gagne côté `establishments` (pas de verrou entre `update_establishment` et
  `moderate_establishment_proposal`) ; à l'approbation, le payload corrigé par l'admin au moment de
  la modération prime toujours (même invariant que `moderate_product_proposal`) — cohérent avec le
  calibrage bas-risque déjà retenu ailleurs pour la modération (pas le harnais anti-survente réservé
  à la réservation).

## 10. Décisions tranchées / points ouverts

**Tranché ici** :
- Portée « premier établissement vs supplémentaire » — un seul mécanisme de proposition socio pour
  les deux cas (§1/§2), `create_establishment` gère déjà les deux identiquement.
- Coexistence admin/socio, jamais remplacement (§3).
- `establishment_proposals` en table séparée, pas de réutilisation de `product_proposals` (§3).
- `status`/archivage — hors périmètre, aucune raison forte trouvée pour l'inclure maintenant.

**Point ouvert, explicitement laissé pour arbitrage séparé** :
- Le gap `transfer_establishment` × `partner_capabilities` (§9) — corriger `transfer_establishment`
  pour réattribuer aussi la capacité `operator` au nouveau partenaire, hors périmètre de cette spec.

**Sort de la spec 05 — décision explicite, pas en silence :**
1. **Correctif de statut**, indépendant du contenu : la spec 05 est en réalité déjà implémentée
   (Feature 29, vérifié dans le code — §1) alors que son frontmatter dit `brouillon` et sa §11 « à
   compléter ». À corriger : `statut: implemente`, §11 remplie avec les fichiers réellement livrés,
   ligne ajoutée à `docs/specs/README.md`.
2. **Ajustement de contenu ciblé**, pas une réécriture — coexistence, pas remplacement :
   - §2 (Portée, « Out ») : la puce « Ajouter un établissement supplémentaire [...] pas tranchés
     ici » devient « tranché par `docs/specs/06-gestion-etablissement.md` ».
   - §5.1 (dashboard) : le texte « pas d'action self-service — le rattachement reste admin-only,
     cf. spec 03 §3 » est remplacé par une référence au lien actionnable vers
     `/partner/establishment/new` (§5 ci-dessus) — le rattachement final reste bien admin-only en
     écriture (`create_establishment` reste la seule fonction qui écrit), seule la **demande**
     devient self-service.
   - §5.6 (préremplissage `/admin/establishments/new?partner_id=`) : conservé tel quel, reformulé
     explicitement comme le filet de sécurité si le partenaire ne fait pas sa demande lui-même — pas
     redondant, un vrai second chemin utile (partenaires onboardés hors-ligne).
   - §10 : ajouter une ligne notant que le point « self-service vs admin-only » est désormais résolu
     par la spec 06.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §1 Contexte (gap admin) | `hifago/apps/admin/app/admin/establishments/[id]/page.tsx`, `EstablishmentPhotosBlock.tsx`, `hifago/docs/03-cahier-des-charges-admin.md` §3c |
| §1 Contexte (absence socio, point ouvert) | `docs/2-reference/02-app-partner.md:461-466`, `hifago/docs/02-cahier-des-charges-socio.md` §3b/§3f, `docs/specs/05-invitations-onboarding-dashboard-partenaire.md` §2/§10 |
| §1/§3 Multi-établissement déjà supporté | `hifago/supabase/migrations/20260813211500_partner_capabilities_establishment_scope.sql`, `20260815110000_gestion_images.sql:504-551` (`create_establishment`) |
| §5 Écrans (patrons réutilisés) | `hifago/apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx`, `hifago/apps/admin/app/partner/(app)/products/[id]/edit/EditProposalForm.tsx`, `ProductPhotosSocioBlock.tsx`, `hifago/apps/admin/app/admin/proposals/{page.tsx,ProposalsTable.tsx,[id]/page.tsx,[id]/ModerateProposalForm.tsx,[id]/ModeratePhotosProposalForm.tsx}` |
| §6/§7 Modèle et RPC (patrons copiés) | `hifago/supabase/migrations/20260813234500_product_proposals.sql`, `20260813240500_moderate_product_proposal_rpc.sql` (nom indicatif — RPC de modération déjà en place, cf. `20260815110000_gestion_images.sql` pour sa version étendue), `20260814150000_partner_registry_rpc.sql` (`transfer_establishment`, patron `security invoker`) |
| §7 Fonctions utilitaires réutilisées | `is_admin`, `partner_id_for_account`, `has_capability` (`20260813211500_partner_capabilities_establishment_scope.sql`), `log_admin_action` (`20260813201000_admin_audit_log.sql`) |
| §8 Invariants | `hifago/CLAUDE.md` §3-4, `hifago/docs/02-cahier-des-charges-socio.md` §3e/§3f |
| §9 Cas limites (gap transfer_establishment) | `hifago/supabase/migrations/20260814150000_partner_registry_rpc.sql:106-140` |
| §10 Correctif spec 05 | `docs/specs/05-invitations-onboarding-dashboard-partenaire.md`, `hifago/apps/admin/app/partner/(app)/page.tsx`, `docs/specs/README.md` |

### Fichiers réellement livrés (2026-08-15)

| Élément | Fichier |
|---|---|
| Migration (table, RLS, 5 RPC) | `hifago/supabase/migrations/20260815170000_gestion_etablissement.sql` |
| Types TypeScript régénérés | `hifago/packages/supabase/src/database.types.ts` |
| Bloc d'édition admin + intégration écran existant | `hifago/apps/admin/app/admin/establishments/[id]/EstablishmentEditBlock.tsx`, `.../page.tsx` (modifié) |
| Sous-arbre socio « Mi establecimiento » | `hifago/apps/admin/app/partner/(app)/establishment/{layout.tsx,page.tsx,PendingCreationBanner.tsx,new/{page.tsx,NewEstablishmentProposalForm.tsx},[id]/edit/{page.tsx,EditEstablishmentProposalForm.tsx}}` |
| Nav + dashboard socio (petits ajouts) | `hifago/apps/admin/app/partner/(app)/PartnerNav.tsx`, `.../page.tsx` (modifiés) |
| Extension écran de modération admin | `hifago/apps/admin/app/admin/proposals/{page.tsx,ProposalsTable.tsx,[id]/page.tsx}` (modifiés), `[id]/ModerateEstablishmentProposalForm.tsx` (nouveau) |
| Tests e2e | `hifago/apps/admin/e2e/admin-establishment-edit.spec.ts`, `partner-establishment-proposals.spec.ts` |

## 12. Documents liés

- `docs/specs/03-admin-creation-etablissement.md` — RPC `create_establishment` réutilisée telle
  quelle, écran de référence pour le style de formulaire et le composant `SearchableCombobox`.
- `docs/specs/04-gestion-images.md` — précédent architectural direct pour le mécanisme de
  proposition modérée (`product_proposals.kind`, `submit_photos_proposal`, extension de
  `moderate_product_proposal`), reproduit ici pour les établissements.
- `docs/specs/05-invitations-onboarding-dashboard-partenaire.md` — dashboard partenaire à ajuster
  (§5.1), badge admin conservé comme filet de sécurité (§5.6), point ouvert §2/§10 résolu ici ;
  statut à corriger (§10 de cette spec).
- `hifago/docs/03-cahier-des-charges-admin.md` §3c — décision « présentation éditable sans
  déploiement » que cette spec construit enfin.
- `hifago/docs/02-cahier-des-charges-socio.md` §3b/§3e/§3f — invitations/onboarding (point ouvert),
  modération de fiches, photos.
- `hifago/CLAUDE.md` §3 (checklist RLS/RPC-only), §11 (pièges empiriques HeroUI).

## Vérification effectuée

- **Backend** : les 5 RPC testées directement (hors UI) sur les 13 scénarios significatifs —
  `update_establishment` (admin + refus non-admin), `submit_establishment_creation_proposal`
  (succès, `name_required`, `pending_creation_exists`), `submit_establishment_edit_proposal`
  (succès, `name_required`, `establishment_not_found`), `moderate_establishment_proposal` (approve
  create avec back-fill `establishment_id` + capacité `operator` créée, approve edit avec
  `operated_directly` préservé, reject), `withdraw_establishment_proposal`. Un bug réel trouvé et
  corrigé à cette occasion (voir « Écarts connus » ci-dessous).
- **Frontend** : `npx tsc --noEmit` (`apps/admin`) et `eslint` propres. Suite Vitest du monorepo
  verte (29 tests, 3 packages). 4 tests e2e dédiés (`admin-establishment-edit.spec.ts`,
  `partner-establishment-proposals.spec.ts`, 3 scénarios) passés deux fois consécutives sans échec,
  y compris le scénario socio pur (retrait) re-vérifié après l'apparition d'un aléa d'environnement
  sans lien avec cette feature (voir ci-dessous). Suite de concurrence anti-survente existante
  (`npm run test:concurrency`) entièrement verte — aucune régression sur les RPC critiques déjà en
  place.
- **Audit `/hifago-review`** (5 domaines, 10 agents — audit initial + vérification adversariale
  indépendante par domaine) : RLS/RPC-only 🟢, anti-survente 🟢 (hors périmètre confirmé), i18n/SEO
  🟢, design system 🟢, fournisseurs écartés 🟢 — aucun écart trouvé.

## Écarts connus, sans lien avec cette feature

- **Bug réel trouvé et corrigé** : `update_establishment` référençait `establishments`/
  `log_admin_action` sans qualification de schéma. Appelée directement par un admin, cela
  fonctionne (search_path par défaut inclut `public`) ; appelée **en nested** depuis
  `moderate_establishment_proposal` (`set search_path = ''`), la résolution échoue
  (`relation "establishments" does not exist`). Trouvé en testant la RPC directement avant de
  construire l'écran (même discipline que le bug `FOUND` de la spec 04) — corrigé en qualifiant
  toutes les références internes en `public.*`, avant tout code applicatif écrit dessus.
- **`node_modules` désynchronisé de `package-lock.json`** (`qrcode`/`@types/qrcode`, déclarés par
  une autre session concurrente pour une fonctionnalité QR code sans lien avec cette spec) —
  `npm install` à la racine du monorepo a suffi à resynchroniser sans toucher au lockfile (déjà
  résolu à la bonne version). Ce désync cassait la compilation de pages sans rapport
  (`/partner/tools`) et, par propagation Turbopack, faisait échouer des routes non liées lors d'un
  run e2e complet — diagnostiqué en cours de vérification, pas une régression de cette feature.
- **Rollout en cours d'un 2FA/AAL2 obligatoire pour les comptes admin**, par une autre session
  concurrente (`hifago/supabase/migrations/20260815250000_admin_2fa_aal2.sql`, `checkMfaGuard`
  posé sur `admin/layout.tsx` ET `partner/(app)/layout.tsx`). Le compte seedé `admin@hifago.test`
  n'a pas encore de facteur TOTP enrôlé localement, donc toute connexion admin programmatique
  (`loginAs`) est redirigée vers `/mfa/enroll` — bloque la ré-exécution de la suite e2e complète et
  des 2 assertions admin de cette feature au moment de la vérification (déjà passées deux fois
  proprement plus tôt dans la session, avant ce rollout). N'affecte pas les comptes socio purs
  (`has_admin_capability` scope le garde) : le test socio (retrait de proposition) a été re-vérifié
  et passe. Aucune action prise sur cette feature MFA (hors périmètre, en cours de construction
  ailleurs) ; à re-vérifier une fois ce rollout stabilisé (ex. `admin@hifago.test` enrôlé en local,
  ou un helper `loginAs`-avec-MFA livré par cette autre session).
- **Précision sur une convention déjà écrite ailleurs** : le skill `/hifago-ui`
  (`.claude/skills/hifago-ui/SKILL.md`) documente encore « français pour `/admin/*`, espagnol pour
  `/partner/*` » — l'audit `/hifago-review` (domaine i18n) a confirmé par grep exhaustif que ce
  n'est plus la réalité du dépôt : tout `apps/admin` (y compris `/admin/*`) est déjà en espagnol
  (confirmé aussi par l'entrée `hifago/CLAUDE.md` du 2026-08-15 sur la correction de langue de
  `/login`). Les fichiers livrés par cette spec respectent la vraie convention (espagnol uniforme).
  Signalé ici, non corrigé dans le skill (hors périmètre de cette spec).
