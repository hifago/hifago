import type pg from "pg";
import { withDb } from "./db";
import { SEEDED_ACCOUNTS } from "./auth";

// NETTOYAGE DE FIN DE SUITE E2E (2026-09-08, demandé par Jérôme : « les tests devraient delete à
// la fin des tests »).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE PROBLÈME, MESURÉ ET PAS SUPPOSÉ
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Les specs e2e créent de vrais produits, établissements, partenaires et catégories, et ne les
// suppriment pas. Constaté le 2026-09-08 sur la base locale : **78 produits résiduels contre 7 au
// seed**. Ce n'est pas seulement du désordre — ça FAIT ÉCHOUER DES TESTS, de deux façons :
//
//   • l'accueil et les listings plafonnent chaque section à 8 offres, dans l'ordre `created_at
//     desc` : les résidus, toujours plus récents que le seed, poussent les offres seedées HORS de
//     l'écran. `home.spec.ts` (« carte groupée ») et `reserve.spec.ts` échouaient exactement
//     ainsi, sur des sélecteurs pourtant justes ;
//   • et les deux suites interfèrent : lancer les e2e ADMIN casse ensuite les e2e WEB, ce qui rend
//     un échec impossible à attribuer.
//
// Six fichiers pgTAP souffrent déjà du même mal (`docs/backlog.md`), pour la même raison.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CE MODULE NETTOIE, ET COMMENT IL RECONNAÎT SES CIBLES
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ **Par l'HORODATAGE, jamais par une liste de noms.** Les specs fabriquent leurs identifiants
// avec `Date.now()` — `actividad-e2e-1788897738585`, `tags-filter-1788897750352`,
// `casa-guatape-es-1788897564057`. Un slug portant treize chiffres commençant par 1 est donc une
// donnée de test, et les sept slugs du seed sont fixes et n'en portent aucun. Une liste de
// préfixes, elle, serait périmée au prochain spec écrit — et personne ne s'en apercevrait.
//
// ⚠️ **Il ne touche JAMAIS aux données du seed.** C'est la propriété qui rend ce nettoyage sûr à
// lancer après chaque suite : `npm run db:setup` reste nécessaire pour repartir de zéro, ce module
// ne fait que rendre à la base l'état où la suite l'a trouvée.

/** Un identifiant fabriqué par `Date.now()` : treize chiffres commençant par 1. */
const MOTIF_HORODATAGE = "1[0-9]{12}";

/**
 * Supprime les entités créées par les specs e2e, dans l'ordre qu'imposent les clés étrangères.
 *
 * ⚠️ L'ORDRE N'EST PAS NÉGOCIABLE et vient de `pg_constraint`, pas d'une intuition : CINQ tables
 * référencent `products` en `NO ACTION` et bloquent donc la suppression — `order_lines`,
 * `product_availability`, `product_calendar`, `product_proposals` et `cart_items` (cette dernière
 * née avec le panier en base le 2026-09-10, oubliée ici jusqu'au 2026-09-17 : la purge entière
 * échouait alors en silence, cf. le commentaire de l'étape 2). Les cinq autres
 * (`product_media`, `product_tag_assignments`, `product_date_rates`, `product_slot_rules`,
 * `product_slot_availability`) sont en CASCADE et partent d'elles-mêmes. Avant d'ajouter une table
 * liée ici, la vérifier de la même façon — c'est la règle de `.claude/rules/tests.md`.
 */
export async function purgerDonneesDeTest(): Promise<{
  produits: number;
  establecimientos: number;
  categorias: number;
  partenaires: number;
  comptes: number;
  journal: number;
}> {
  return withDb(async (client) => {
    const { rows: cibles } = await client.query<{ id: string }>(
      `select id from products where slug ~ $1`,
      [MOTIF_HORODATAGE]
    );
    const idsProduits = cibles.map((r) => r.id);

    if (idsProduits.length > 0) {
      // 1. Les commandes qui touchent ces produits. On supprime la LIGNE d'abord, puis la commande
      //    seulement si elle devient orpheline — même prudence que `purgePaymentsThenOrders` :
      //    une commande portant aussi une ligne vers un produit du seed ne doit pas disparaître.
      const { rows: lignes } = await client.query<{ id: string; order_id: string }>(
        `select id, order_id from order_lines where product_id = any($1)`,
        [idsProduits]
      );
      const idsLignes = lignes.map((r) => r.id);
      const idsCommandes = [...new Set(lignes.map((r) => r.order_id))];

      if (idsLignes.length > 0) {
        // ⚠️ CE QUI POINTE VERS LA **LIGNE** D'ABORD. Vérifié dans `pg_constraint` le 2026-09-08 —
        // après un premier essai qui a échoué exactement là : `ledger_entries.order_line_id` est en
        // NO ACTION, donc supprimer `order_lines` en premier lève
        // « violates foreign key constraint ledger_entries_order_line_id_fkey ». Les trois tables
        // ci-dessous référencent la LIGNE, pas la commande, et c'est une distinction qui ne se
        // devine pas depuis le nom.
        for (const table of ["ledger_entries", "pms_reconciliation_entries", "availability_blocks"]) {
          await client
            .query(`delete from ${table} where order_line_id = any($1)`, [idsLignes])
            .catch(() => {
              // Une table ou une colonne absente de ce schéma n'est pas une erreur : ce module doit
              // survivre à une base plus ancienne ou plus récente sans faire échouer une suite déjà
              // terminée.
            });
        }

        // ⚠️ `order_lines` s'auto-référence (NO ACTION). Un DELETE unique fonctionne quand même :
        // une contrainte NO ACTION est vérifiée en FIN d'instruction, donc les lignes qui se
        // pointent entre elles partent ensemble. Les supprimer une par une échouerait.
        await client.query(`delete from order_lines where product_id = any($1)`, [idsProduits]);
      }

      if (idsCommandes.length > 0) {
        await client
          .query(`delete from payments where order_id = any($1)`, [idsCommandes])
          .catch(() => {});

        // Seulement les commandes devenues ORPHELINES : une commande portant encore une ligne vers
        // un produit du seed n'a rien à faire ici.
        await client.query(
          `delete from orders where id = any($1)
             and id not in (select distinct order_id from order_lines)`,
          [idsCommandes]
        );
      }

      // 2. Les tables en NO ACTION qui bloquent la suppression du produit (`order_lines` est
      // traitée juste au-dessus, avec les commandes).
      //
      // ⚠️ `cart_items` AJOUTÉE LE 2026-09-17, après un échec réel du teardown. Elle est née avec
      // le panier en base (spec 32, 2026-09-10) et personne ne l'a ajoutée ici — invisible pendant
      // une semaine parce que la suite e2e est en pause depuis le 2026-09-09. Le symptôme est
      // trompeur : le teardown échoue APRÈS que tous les tests sont passés, donc la suite rougit
      // sur un test qui a réussi, et la base garde TOUS ses résidus (le catch englobe la purge
      // entière). Liste revérifiée dans `pg_constraint` le 2026-09-17 — cinq FK en NO ACTION vers
      // `products`, pas quatre. Toute table liée ajoutée plus tard se vérifie de la même façon,
      // jamais en la devinant.
      for (const table of ["product_availability", "product_calendar", "product_proposals", "cart_items"]) {
        await client.query(`delete from ${table} where product_id = any($1)`, [idsProduits]);
      }

      // 3. Les produits eux-mêmes ; le reste part en CASCADE.
      await client.query(`delete from products where id = any($1)`, [idsProduits]);
    }

    // 4. Les établissements de test, une fois leurs produits partis.
    //
    // ⚠️ NEUF TABLES les référencent, dont HUIT en NO ACTION — seule `establishment_media` est en
    // CASCADE (vérifié dans `pg_constraint` le 2026-09-08, après un échec sur
    // `partner_capabilities_establishment_id_fkey`). Celles qui bloquent réellement en pratique
    // sont listées ci-dessous ; les autres ont déjà été vidées par la purge des produits et des
    // commandes. Une table liée ajoutée plus tard devra être vérifiée de la même façon, pas
    // devinée.
    const { rows: etabs } = await client.query<{ id: string }>(
      `select id from establishments where slug ~ $1
         and id not in (select distinct establishment_id from products where establishment_id is not null)`,
      [MOTIF_HORODATAGE]
    );
    const idsEtabs = etabs.map((r) => r.id);

    let est = { rowCount: 0 } as { rowCount: number | null };
    if (idsEtabs.length > 0) {
      for (const table of [
        // Une capacité partenaire SCOPÉE à un établissement de test n'a plus d'objet une fois
        // celui-ci parti — c'est cette table qui bloquait.
        "partner_capabilities",
        "establishment_payout_accounts",
        "establishment_proposals",
        "product_proposals",
        "provider_resource_calendar",
        "pms_cancellation_queue",
      ]) {
        await client
          .query(`delete from ${table} where establishment_id = any($1)`, [idsEtabs])
          .catch(() => {
            // Table ou colonne absente de ce schéma : ce module doit survivre à une base plus
            // ancienne ou plus récente sans faire échouer une suite déjà terminée.
          });
      }
      est = await client.query(`delete from establishments where id = any($1)`, [idsEtabs]);
    }

    // 5. Les catégories de test (`tags-filter-…`, `tags-delete-…`). Les assignations sont en
    //    CASCADE des deux côtés.
    const cat = await client.query(`delete from catalog_tags where slug ~ $1`, [MOTIF_HORODATAGE]);

    // APRÈS les établissements : un partenaire de test qui en posséderait encore un horodaté ne
    // pourrait pas partir (FK establishments.partner_id).
    const partenaires = await purgerPartenairesDeTest(client);

    return {
      produits: idsProduits.length,
      establecimientos: est.rowCount ?? 0,
      categorias: cat.rowCount ?? 0,
      ...partenaires,
    };
  });
}

/**
 * Partenaires, codes, invitations et comptes fabriqués par les specs (2026-10-07, suite de l'audit
 * P12 : `admin-partner-create`, `admin-invitations` et `partner-join` en laissaient à chaque run —
 * mesuré par comptage avant/après, +4 partenaires, +3 codes, +3 invitations, plus les capacités,
 * profils, accords et lignes de journal qui vont avec). Même règle que plus haut, l'HORODATAGE :
 *   • un code portant treize chiffres (`E2ECOMPLETO1788…`, `E2E-REVOKE-1788…`) ;
 *   • un partenaire dont le nom en porte (`Partner E2E Mínimo 1788…`) ou qui détient un tel code ;
 *   • un compte dont l'e-mail en porte juste avant l'arobase (`prestador-e2e-1788…@test.local`).
 * Plus le journal d'audit que les comptes de test (seedés ou fabriqués) ont écrit PENDANT la suite :
 * chaque geste admin d'un spec en laisse une ligne, y compris sur des données du seed (bascule du
 * code SEED-REFACTIVE). La borne de début vient de `globalSetup.ts` ; sans elle (teardown lancé à
 * part), seules les lignes rattachées aux entités purgées partent.
 *
 * ⚠️ L'ordre vient de `pg_constraint` (NO ACTION partout) : journal et dépendances d'abord,
 * partenaires puis comptes ensuite. Un partenaire de test qui porterait encore une donnée non
 * prévue ici (une commande, un établissement sans horodatage) reste en base et le dit : sa
 * suppression échoue seule, sans faire échouer le reste.
 */
async function purgerPartenairesDeTest(
  client: pg.Client
): Promise<{ partenaires: number; comptes: number; journal: number }> {
  const { rows: codes } = await client.query<{ code: string }>(
    `select code from partner_codes where code ~ $1`,
    [MOTIF_HORODATAGE]
  );
  const codesTest = codes.map((r) => r.code);
  const { rows: partenaires } = await client.query<{ id: string }>(
    `select id from partners
      where display_name ~ $1
         or id in (select partner_id from partner_codes where code = any($2) and partner_id is not null)`,
    [MOTIF_HORODATAGE, codesTest]
  );
  const idsPartenaires = partenaires.map((r) => r.id);
  const { rows: comptes } = await client.query<{ id: string }>(
    `select id from auth.users where email ~ ($1 || '@')`,
    [MOTIF_HORODATAGE]
  );
  const idsComptes = comptes.map((r) => r.id);

  // Journal : les lignes des comptes fabriqués, celles qui visent une entité purgée ci-dessous, et
  // — borne connue — tout ce que les comptes de test ont écrit depuis le début de la suite.
  const { rows: seedes } = await client.query<{ id: string }>(
    `select id from auth.users where email = any($1)`,
    [Object.values(SEEDED_ACCOUNTS)]
  );
  const debut = process.env.E2E_RUN_STARTED_AT ?? null;
  const journal = await client.query(
    `delete from audit_log
      where actor_id = any($1::uuid[])
         or entity_id = any($2::uuid[])
         or entity_id in (select id from partner_capabilities
                           where partner_id = any($2::uuid[]) or account_id = any($1::uuid[]))
         or entity_id in (select id from partner_invitations
                           where promo_code = any($3) or partner_id = any($2::uuid[]))
         or ($4::timestamptz is not null and created_at >= $4::timestamptz
             and actor_id = any($5::uuid[]))`,
    [idsComptes, idsPartenaires, codesTest, debut, seedes.map((r) => r.id)]
  );

  if (idsPartenaires.length === 0 && idsComptes.length === 0 && codesTest.length === 0) {
    return { partenaires: 0, comptes: 0, journal: journal.rowCount ?? 0 };
  }

  const P = idsPartenaires;
  const A = idsComptes;
  const C = codesTest;
  await client.query(`delete from role_agreements where partner_id = any($1::uuid[]) or account_id = any($2::uuid[])`, [P, A]);
  await client.query(`delete from partner_capabilities where partner_id = any($1::uuid[]) or account_id = any($2::uuid[])`, [P, A]);
  await client.query(`delete from partner_crm_profile where partner_id = any($1::uuid[])`, [P]);
  await client.query(`delete from partner_payout_accounts where partner_id = any($1::uuid[])`, [P]);
  await client.query(`delete from partner_offboarding where partner_id = any($1::uuid[])`, [P]);
  await client.query(`delete from establishment_proposals where partner_id = any($1::uuid[])`, [P]);
  await client.query(`delete from product_proposals where partner_id = any($1::uuid[])`, [P]);
  await client.query(
    `delete from partner_invitations
      where promo_code = any($1) or partner_id = any($2::uuid[])
         or consumed_by_account_id = any($3::uuid[]) or created_by = any($3::uuid[])`,
    [C, P, A]
  );
  await client.query(`update partner_accounts set saved_attribution_code = null where saved_attribution_code = any($1)`, [C]);
  // TOUS les comptes rattachés, y compris ceux de test supprimés plus bas : partners part AVANT
  // auth.users, et un compte encore rattaché bloquerait son partenaire (partner_accounts_partner_id_fkey).
  await client.query(`update partner_accounts set partner_id = null where partner_id = any($1::uuid[])`, [P]);
  await client.query(`delete from notification_emails where recipient_account_id = any($1::uuid[])`, [A]);
  await client.query(`delete from cart_items where account_id = any($1::uuid[])`, [A]);
  await client.query(`delete from carts where account_id = any($1::uuid[])`, [A]);
  await client.query(`delete from partner_codes where code = any($1) or partner_id = any($2::uuid[])`, [C, P]);

  let partenairesPurges = 0;
  for (const id of P) {
    const r = await client.query(`delete from partners where id = $1`, [id]).catch((erreur) => {
      console.warn(`[e2e cleanup] partenaire de test ${id} conservé :`, (erreur as Error).message);
      return null;
    });
    partenairesPurges += r?.rowCount ?? 0;
  }
  // auth.users → partner_accounts en CASCADE.
  let comptesPurges = 0;
  for (const id of A) {
    const r = await client.query(`delete from auth.users where id = $1`, [id]).catch((erreur) => {
      console.warn(`[e2e cleanup] compte de test ${id} conservé :`, (erreur as Error).message);
      return null;
    });
    comptesPurges += r?.rowCount ?? 0;
  }
  return { partenaires: partenairesPurges, comptes: comptesPurges, journal: journal.rowCount ?? 0 };
}

/**
 * `globalTeardown` Playwright — à brancher dans les deux `playwright.config.ts`.
 *
 * ⚠️ **Un teardown GLOBAL et pas un `afterAll` par spec**, et c'est un choix : un nettoyage réparti
 * dans vingt fichiers s'oublie au vingt-et-unième, et personne ne le remarque avant que la base
 * ait de nouveau dix fois plus de résidus que de seed. Ici, un spec neuf est couvert sans que son
 * auteur ait à y penser.
 *
 * ⚠️ CE QU'IL NE RÉSOUT PAS : l'interférence PENDANT une même exécution. Deux tests parallèles qui
 * remplissent la même section de 8 offres se gênent encore — `cart-multi-establishment` passe seul
 * et échoue en suite, pour cette raison. La correction de ce cas-là est de scoper les données par
 * test, pas de nettoyer à la fin ; c'est un lot à part, nommé au backlog.
 *
 * Il n'échoue JAMAIS la suite : un nettoyage raté est un problème d'hygiène, pas un résultat de
 * test. Il le dit sur la sortie standard et rend la main.
 */
export default async function globalTeardown() {
  try {
    const bilan = await purgerDonneesDeTest();
    const total =
      bilan.produits + bilan.establecimientos + bilan.categorias + bilan.partenaires + bilan.comptes + bilan.journal;
    if (total > 0) {
      console.log(
        `[e2e cleanup] purgé : ${bilan.produits} produit(s), ` +
          `${bilan.establecimientos} établissement(s), ${bilan.categorias} catégorie(s), ` +
          `${bilan.partenaires} partenaire(s), ${bilan.comptes} compte(s), ${bilan.journal} ligne(s) de journal.`
      );
    }
  } catch (erreur) {
    console.warn(
      "[e2e cleanup] nettoyage de fin de suite impossible — la base locale garde ses résidus :",
      erreur
    );
  }
}
