---
id: specs-admin-creation-partenaire
titre: "Admin crée un partenaire"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-08-14
resume: >
  Spec de l'écran admin qui crée un partenaire directement (identité, capacités et profil
  commercial en une transaction), sans passer par l'auto-enregistrement sur invitation.
mots_cles: [admin, creation partenaire, CRM, invitation, capacites, role_agreements, hifago, partner_crm_profile]
repond_a:
  - "Comment l'admin crée-t-il un partenaire sans passer par l'auto-enregistrement ?"
  - "Quels champs unifier dans l'écran de création admin ?"
  - "Quelle RPC et quelle migration construire pour la création directe d'un partenaire ?"
---

# Admin crée un partenaire

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`), pas l'app legacy. **Feature n°26**
> (dernière feature migrée côté hifago avant celle-ci : 25, `campaign_engine.sql`, 2026-08-14) —
> numéro de build, distinct du `01-` de ce fichier qui est un compteur de docs.
>
> **Implémenté le 2026-08-14**, dans la foulée de la spec, sans repasser par une approbation
> intermédiaire séparée (décision Jérôme, même session) — migration, RPC, écran admin et tests e2e
> livrés d'un seul tenant. Fichiers réels en annexe §11. Les statuts ci-dessous décrivent une spec
> **réalisée telle quelle**, pas une revue section par section validée a posteriori par Jérôme —
> à corriger ici si un écart est trouvé à l'usage.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écran admin | implémenté |
| 6 | Modèle de données | implémenté |
| 7 | Contrat RPC | implémenté |
| 8 | Règles et invariants | implémenté |
| 9 | Cas limites | implémenté |
| 10 | Décisions tranchées pour ce build | implémenté |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 1. Contexte et problème

**Dans l'app legacy actuelle, l'admin ne crée jamais un partenaire en un seul geste.** Le flux
est en deux temps, portés par deux acteurs différents :

1. L'admin crée une **invitation** (`POST /api/admin/partner-invitations`,
   `src/controllers/partnerController.js:57-118` → `src/services/partnerService.js:170-200`) —
   seuls champs disponibles : code promo, `path` (`referrer`/`provider`), TTL, et un
   `partner_hint` optionnel (`display_name`, `entity_type`, `partner_city`, `provider_id`).
2. C'est le **partenaire**, en s'auto-enregistrant via le lien reçu (à la main, par WhatsApp),
   qui crée réellement `partners` + `partner_accounts` + `partner_codes` + `partner_capabilities`
   en transaction (`partnerService.js:256-333`). Rien n'existe avant ce moment.

Un bouton admin « ＋ Nouveau partenaire » existe (`public/admin.js:1861-1992`) mais crée
uniquement une fiche CRM prospect (`data/crm.json`) — **pas** un compte, **pas** une invitation.
C'est un piège déjà documenté (`docs/2-reference/03-app-admin.md:204`) : deux boutons qui se
ressemblent, deux effets radicalement différents.

Les données commerciales (banque, adresse, barrio, tags, notes, dernier contact/paiement) vivent
à part dans `crm.json`, éditées après coup par l'admin via la fiche « 360 » — jamais à la
création. La banque n'est même jamais saisie par l'admin : seulement par le partenaire lui-même,
depuis son propre portail. La commission n'est **pas** un champ par partenaire : c'est une
constante/matrice globale (`COMMISSION_RATE` legacy, ou matrice 17/10/7 côté cible). Les colonnes
`legal_name`, `identification_type`, `identification_number` existent déjà dans le schéma
`partners` (legacy **et** hifago) mais ne sont écrites nulle part dans le code — colonnes mortes
réservées à un futur KYC.

**Côté hifago, la cible a déjà été validée mais n'est pas construite.**
`hifago/docs/03-cahier-des-charges-admin.md` §2 (validé par Jérôme le 2026-08-11) :

> « L'admin gère aussi **tous les comptes** du système (client, socio, admin) directement :
> création, modification, désactivation — pas seulement les capacités référent/prestataire. »

Aucune RPC ni migration ne l'implémente aujourd'hui. Seules existent `create_partner_invitation`
(l'admin crée une invitation) et `consume_partner_invitation` (le **partenaire** crée sa propre
ligne `partners`, en `FOR UPDATE` sur l'invitation —
`hifago/supabase/migrations/20260813171334_consume_partner_invitation_rpc.sql:62-99`). Cette
dernière insère déjà une ligne `role_agreements` (`explicit_consent=true`) au moment de la
consommation : l'acceptation de contrat **est** câblée, mais seulement pour ce chemin
invitation-puis-auto-enregistrement.

Cette spec comble ce manque : un vrai chemin de création directe par l'admin, qui reprend et
unifie ce que l'app legacy fait déjà (identité + capacités + CRM), sans réinventer de mécanisme
nouveau là où l'existant suffit (cf. §3, §4, §10).

## 2. Portée

**In** : un écran admin unique qui crée, en une transaction, l'identité (`partners`), les
capacités demandées (`partner_capabilities`), un code d'attribution optionnel (`partner_codes`)
et un profil commercial optionnel (`partner_crm_profile`, nouveau) — avec la possibilité
d'envoyer dans la foulée une invitation de connexion au partenaire.

**Out, explicitement renvoyé ailleurs :**
- Édition d'une fiche déjà existante (relève d'une future spec « fiche 360 », déjà évoquée au
  cahier des charges admin §3e).
- Carte et itinéraire de visite (§3e du cahier des charges).
- La matrice de commission elle-même — non touchée par cette feature (§10).
- Le schéma `establishments.payout_method` — dépendance identifiée (§10), pas résolue ici.

## 3. Décisions retenues

Ne pas rouvrir :
- Le rôle admin gère tous les comptes directement (cahier des charges admin §2, validé
  2026-08-11).
- `operator ⇒ referrer` : accorder la capacité prestataire accorde toujours la capacité référent
  avec (cahier des charges admin §3d, invariant déjà imposé côté code par `grant_capability`).
- `partner_capabilities.source` accepte déjà la valeur `'admin'` dans sa contrainte `check`
  (migration `20260813161117_identity_core_tables.sql`) — aucune évolution de schéma nécessaire
  sur ce point précis.
- Toute écriture admin est auditée, attribuée à l'identité nominative qui l'a faite (cahier des
  charges admin §1/§4) — cette RPC journalise comme toutes les RPC admin voisines
  (`grant_capability`, `create_partner_invitation`).
- Champs commerciaux unifiés dans l'écran de création (décision Jérôme, 2026-08-14) : un seul
  écran identité + commercial, pas deux étapes séparées comme aujourd'hui en legacy.

## 4. Parcours cible

1. L'admin ouvre `/admin/partners/new` (à côté de l'écran d'invitation existant).
2. Il remplit le formulaire unique décrit en §5/§6 : identité, rôle(s) demandé(s), code
   d'attribution optionnel, profil commercial optionnel.
3. Il coche (par défaut) « envoyer une invitation de connexion » — ou la décoche pour créer une
   fiche purement commerciale, sans compte de connexion (cf. cas limite §9).
4. Soumission → une seule RPC (`create_partner_direct`, §7) crée `partners` +
   `partner_capabilities` (+ `partner_codes` si un code est fourni) + `partner_crm_profile` (si
   un profil commercial est rempli), en une transaction.
5. Si l'invitation est demandée, la RPC crée aussi une `partner_invitations` **déjà rattachée**
   au `partner_id` qui vient d'être créé (extension de schéma, §6) — la RPC
   `consume_partner_invitation` existante est étendue pour s'attacher à ce partenaire déjà créé
   au lieu d'en fabriquer un nouveau à la consommation. C'est une réutilisation de l'infrastructure
   d'invitation déjà éprouvée (token haché, TTL, usage unique) — pas un nouveau mécanisme de mot
   de passe posé par l'admin (cf. §10).
6. Le partenaire reçoit le lien (même canal manuel qu'aujourd'hui — WhatsApp ; **révisé le
   2026-10-13** : il part aussi par e-mail quand l'admin saisit l'e-mail du socio, voir §10), clique, se
   connecte (email+password ou Google) : son compte se rattache au `partner_id` déjà créé par
   l'admin, `role_agreements` s'enregistre à ce moment comme aujourd'hui.

## 5. Écran admin

Un seul écran, quatre blocs visuels (un seul écran ≠ une seule table, cf. §6) :

1. **Identité** — display_name, entity_type, legal_name, identification_type/number, email,
   phone, partner_city.
2. **Capacités demandées** — référent et/ou prestataire (au moins un), établissement à rattacher
   si prestataire et déjà connu.
3. **Code d'attribution** *(optionnel)* — code, commission activée (case, défaut coché).
4. **Profil commercial** *(optionnel)* — banque, adresse, barrio, tags, statut commercial, notes,
   dernier contact/paiement, position carte. **Adresse → recherche Google Places au fil de la
   frappe** (précision Jérôme, 2026-08-14) : l'admin tape, une liste de suggestions Google
   apparaît, en choisir une remplit l'**adresse complète** ET `lat`/`lon` en un seul geste
   (`google.maps.places.Autocomplete`, restreint à la Colombie comme le fait déjà
   `public/admin.js:821` en legacy) — plus riche que le simple `Geocoder` au blur du legacy
   (`public/admin.js:817-826`), gardé en repli si l'admin tape/colle une adresse sans choisir de
   suggestion. Réutilise l'infrastructure déjà décidée côté cahier des charges admin §3e pour les
   établissements. Correction manuelle de `lat`/`lon` toujours possible ensuite (une suggestion
   peut se tromper). Aucune intégration Google Maps n'existe encore dans `hifago/` à ce jour
   (établissements compris) : construite ici localement à `apps/admin`, pas extraite en
   `packages/` par anticipation (règle déjà en vigueur, `hifago/CLAUDE.md` §2.1 — un module ne
   migre vers `packages/` que prouvé consommé par les deux apps) ; à factoriser le jour où les
   établissements la construisent aussi, pas avant.

Plus une case « envoyer une invitation de connexion » (§4, point 3), cochée par défaut.

## 6. Modèle de données

| Table | Statut |
|---|---|
| `partners` | Déjà supportée, réutilisée telle quelle. |
| `partner_capabilities` | Déjà supportée, réutilisée telle quelle. |
| `partner_codes` | Déjà supportée, réutilisée telle quelle. |
| `partner_invitations` | Déjà supportée ; ajout d'une colonne `partner_id uuid references partners(id)` nullable, pour s'attacher à un partenaire déjà créé par l'admin. |
| `partners.legal_name` / `identification_type` / `identification_number` | Colonnes existantes, mortes (jamais écrites, ni legacy ni hifago) — activées par cette feature. |
| `partner_crm_profile` *(nouvelle)* | 1:1 avec `partners`, RPC-only. Reprise fidèle de `crm.json` legacy — cohérente avec la décision déjà actée « fiche CRM commerciale... distincte du profil de compte » (cahier des charges admin §4). |

`partner_crm_profile` n'avait **aucun équivalent dans hifago avant cette feature** : un vrai trou
d'architecture par rapport au legacy, pas seulement un champ à copier. Colonnes réellement livrées
(`hifago/supabase/migrations/20260814233000_partner_direct_creation.sql`) : `partner_id` (PK/FK),
`bank jsonb` (même forme que `crm.json` legacy : `{nombre, bancolombia?, nequi?, received_at}`,
pas de colonnes séparées par méthode de paiement — fidèle à la structure existante plutôt qu'une
normalisation nouvelle), `address`, `barrio`, `tags text[]`, `commercial_status`, `notes`,
`last_contact_at`, `last_payment_at`, `rdv_at`, `lat`, `lon`.

## 7. Contrat RPC

Signature livrée (`hifago/supabase/migrations/20260814233000_partner_direct_creation.sql`),
calquée sur le squelette déjà validé de `hifago/docs/05-reference-technique.md` (identique à
`grant_capability`/`create_partner_invitation` — pas un nouveau patron de RPC) :

```
create_partner_direct(
  p_display_name text,
  p_entity_type text,                        -- 'person' | 'organization'
  p_roles text[],                            -- au moins 'referrer' ou 'operator'
  p_legal_name text default null,
  p_identification_type text default null,
  p_identification_number text default null,
  p_partner_city text default null,
  p_email text default null,
  p_phone text default null,
  p_establishment_id uuid default null,      -- rattachement operator immédiat, rare à la création
  p_code text default null,
  p_commission_enabled boolean default true,
  p_crm_profile jsonb default null,
  p_send_invitation boolean default true,
  p_invitation_expires_days int default 14
) returns jsonb
```

`security definer`, `set search_path = ''`, vérifie `is_admin(auth.uid())` en entrée, journalise
via le même mécanisme d'audit que les RPC admin voisines. Pas de `SELECT ... FOR UPDATE` : aucune
ressource à capacité limitée n'est touchée par une simple création d'identité (contrairement à une
réservation) — le squelette anti-survente complet ne s'applique pas ici, seul le squelette de
sécurité de base (security definer + search_path vide + vérification de rôle) s'applique.

Extension nécessaire de `consume_partner_invitation` : si `partner_invitations.partner_id` est
déjà renseigné, la fonction rattache le compte à ce `partner_id` existant au lieu d'en insérer un
nouveau (le reste de la logique — capacités, `role_agreements`, verrouillage — inchangé).

## 8. Règles et invariants

- Checklist RLS/RPC-only non négociable de `hifago/CLAUDE.md` §3 pour toute nouvelle table
  (`partner_crm_profile` : RPC-only si elle porte un jour un compteur, sinon RLS directe suffit —
  à trancher au moment du code selon ce qu'elle porte réellement).
- `operator ⇒ referrer` toujours respecté par la RPC (§3).
- Toute écriture admin auditée, attribuée nominativement (§3).
- Un code déjà attribué ne se renomme pas librement (invariant déjà acté, cahier des charges admin
  §5) — s'applique tel quel à un code créé par cette RPC.

## 9. Cas limites

- **Email déjà présent dans `auth.users`** (identité unifiée client/socio/admin) → proposer un
  rattachement de capacités via `grant_capability` existant plutôt qu'un blocage sec ou une
  invitation inutile (§10).
- **Partenaire créé sans jamais d'invitation envoyée** (case décochée à l'étape 3) → fiche
  purement commerciale, capacité reste `onboarding` indéfiniment tant qu'aucun compte n'existe
  pour accepter le contrat (`role_agreements.account_id not null` l'empêche structurellement) —
  cohérent avec l'invariant existant, rien à débloquer.
- **Création concurrente par deux admins** avec le même `display_name` → pas un problème
  d'unicité, `display_name` n'est pas une clé ; seule `partner_codes.code` est unique et protégée
  par la contrainte existante.

## 10. Décisions tranchées pour ce build

Chaque point non couvert par le contexte (§1) ou une décision déjà validée (§3) est tranché ici
avec une recommandation ancrée dans l'existant — jamais un choix arbitraire nouveau — pour ne pas
bloquer le développement direct :

- **Commission par partenaire ou globale ?** → reste **globale** (matrice/constante), aucun champ
  « % commission » sur l'écran de création malgré la présence de `commission_enabled` dans le
  tableau §6 (qui est un booléen d'activation, pas un taux).
- **L'admin peut-il saisir la banque à la place du partenaire ?** → **oui**, pour accélérer
  l'onboarding ; toujours ré-écrasable ensuite par le partenaire depuis son propre portail
  (dernière écriture gagne, jamais un verrou côté admin qui bloquerait le partenaire).
- **Bootstrap du mot de passe pour une création admin directe ?** → **réutiliser** l'infrastructure
  `partner_invitations`/`consume_partner_invitation` déjà éprouvée (§4, §6, §7) — ne jamais poser
  un mot de passe côté admin.
- **Statut de capacité au départ : `onboarding` ou `active` immédiat ?** → **`onboarding`** par
  défaut, cohérent avec l'invariant « pas de payout avant acceptation de contrat » ; une case
  explicite « le contrat a déjà été signé hors ligne » pourra forcer `active` — jamais un défaut
  silencieux.
- **Coexistence ou remplacement du flux d'invitation actuel (`/newp`, `/newr`) ?** →
  **coexistence** : trois chemins vers le même modèle, distingués par `partner_capabilities.source`
  (`newp`/`newr`/`admin`).
- **Emplacement réel des données bancaires ?** → `partner_crm_profile` reste une donnée de
  contact/prospection **provisoire**, non connectée au vrai mécanisme de payout tant que
  `establishments.payout_method` n'existe pas dans le schéma (absent de
  `20260813210000_establishments_core_table.sql`, vérifié) — à marquer clairement dans l'UI pour
  ne pas laisser croire qu'un virement s'appuiera dessus.
- **Invitation par e-mail (Gabriel, 2026-10-13, recette de prod)** : quand l'invitation est
  demandée ET qu'un e-mail est saisi, `create_partner_direct` enfile aussi l'e-mail
  `partner_invitation` (`20261014024303`), avec le mécanisme et l'isolation de
  `create_partner_invitation` ; le lien reste affiché à l'écran. Sans e-mail : lien seul, comme avant.

## 11. Annexe — traçabilité code→règle

### Sources ayant informé la spec (comportement existant, legacy et hifago)

| Section | Fichiers sources |
|---|---|
| §1 Contexte | `src/controllers/partnerController.js:57-118`, `src/services/partnerService.js:170-200,256-333`, `public/admin.js:1861-1992`, `docs/2-reference/03-app-admin.md:204`, `hifago/docs/03-cahier-des-charges-admin.md` §2 |
| §4/§7 Parcours et RPC | `hifago/supabase/migrations/20260813171334_consume_partner_invitation_rpc.sql`, `hifago/docs/05-reference-technique.md` |
| §6 Modèle de données | `hifago/supabase/migrations/20260813161117_identity_core_tables.sql`, `20260813211500_partner_capabilities_establishment_scope.sql`, `20260813210000_establishments_core_table.sql`, `hifago/docs/00-modele-de-donnees.md:31,43-53` |
| §8 Invariants | `hifago/CLAUDE.md` §3-4 |

### Fichiers réellement livrés (2026-08-14)

| Élément | Fichier |
|---|---|
| Migration (table `partner_crm_profile`, colonne `partner_invitations.partner_id`, RPC `create_partner_direct`, extension de `consume_partner_invitation`) | `hifago/supabase/migrations/20260814233000_partner_direct_creation.sql` |
| Types TypeScript régénérés | `hifago/packages/supabase/src/database.types.ts` |
| Écran admin | `hifago/apps/admin/app/admin/partners/new/page.tsx`, `NewPartnerForm.tsx`, `geocode.ts` |
| Lien depuis le registre | `hifago/apps/admin/app/admin/partners/page.tsx` (bouton « Nuevo partner ») |
| Variable d'environnement optionnelle (géocodage) | `hifago/apps/admin/.env.example` (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) |
| Tests E2E (Playwright) | `hifago/apps/admin/e2e/admin-partner-create.spec.ts` — 3 scénarios : création minimale sans invitation, création prestador+code+profil commercial+invitation, prestador seul coché (vérifie l'invariant `operator ⇒ referrer` côté RPC) |
| Piège HeroUI découvert en écrivant les tests (Checkbox, distinct du Switch déjà documenté) | `hifago/packages/e2e-support/src/dom.ts` (`checkboxInput`/`toggleCheckbox`), consigné `hifago/CLAUDE.md` §11 point 5 |

## 12. Documents liés

- `hifago/docs/03-cahier-des-charges-admin.md` §2, §3d — vision globale du rôle admin (note de
  renvoi vers cette spec ajoutée dans le même commit).
- `hifago/docs/00-modele-de-donnees.md` — audit champ par champ des entités partagées, section
  Google Maps (géocodage réutilisé pour l'adresse du profil commercial, §5).
- `docs/5-conception/roles-composables.md` — précédent de style invitation/capacités, stack
  legacy.
- `hifago/CLAUDE.md` §11 point 5 — piège empirique Checkbox découvert en testant cette feature.

### Écart connu, sans lien avec cette feature

En vérifiant la non-régression (e2e `partner-join`, `admin-establishment`, `admin-partner-registry`
autour des tables/RPC touchées), un test préexistant échoue de façon reproductible **avec et sans**
cette migration (isolé par retrait temporaire du fichier de migration, DB reset entre les deux) :
`admin-partner-registry.spec.ts` (bascule du switch « código activo », RPC `set_partner_code_active`,
non modifiée par cette feature). Bug préexistant, non provoqué ni corrigé ici — à consigner au
backlog (§ hors périmètre de cette spec).

**Piste supplémentaire notée en testant la recherche d'adresse (2026-08-15)** : le même symptôme
(clic sur « Ver » dans `PartnersTable`/`admin-partner-registry` qui ne navigue pas, reste sur
`/admin/partners`) est réapparu, cette fois dans `admin-partner-create.spec.ts`, mais **uniquement
avec un registre partenaires très chargé** (25+ lignes accumulées par des runs e2e répétés sans
`db reset` entre eux, pendant une longue session de débogage) — reproductible à volonté avec un
registre chargé, disparaît systématiquement après `supabase db reset`. Corrèle avec la taille du
tableau plutôt qu'avec une feature précise — piste utile pour qui investiguera le bug préexistant
ci-dessus.
