import { cache } from "react";
import {
  asLocalizedField,
  asLodgingKind,
  cuposPerUnit,
  hasActiveRestriction,
  isPmsBacked,
  lastBookableDateIso,
  resolveLocalizedField,
  todayInBogota,
} from "@hifago/domain";
import { createPublicClient } from "@/lib/supabase/publicClient";
import { resolverPrograma } from "@/lib/catalog/programa";
import { hasNativeContent } from "@/lib/seo/nativeContent";
import { routing } from "@/i18n/routing";
import { TELEFONO_HIFAGO, urlDeContacto } from "@/lib/contacto/whatsapp";
import { esTipoOferta, resolverPrecio } from "./tipos";
import { agruparAmenidadesPorCategoria, type FilaAmenidad } from "./amenidades";
import type {
  FichaProducto,
  FilaDisponibilidad,
  FilaFranja,
  FilaTarifa,
  FotoTarjeta,
  ModoReserva,
} from "./tipos";

// La fiche d'une offre — spec 30 §7b. Ce module retire `productos/[slug]/page.tsx` de la liste
// d'exemptions de `scripts/check-data-layer.sh` : les six requêtes qu'il portait vivent ici.
//
// ⚠️ CE QUE CE DÉPLACEMENT NE FAIT PAS : réduire le nombre d'allers-retours. Le regroupement en
// `Promise.all` et l'unique attente séquentielle (les créneaux dépendent du comptage des règles)
// sont repris À L'IDENTIQUE. Le contrôle CI ne mesure que l'ENDROIT d'où part une requête, jamais
// leur nombre — croire que son vert prouve autre chose serait une erreur de lecture.
//
// ⚠️ CLIENT ANONYME SANS COOKIES (invariant 3 de la spec 27), là où la page utilisait le client
// à session. Conséquence réelle, et voulue : un admin connecté ne peut plus prévisualiser une
// fiche non publiée — `products_select_public` lui ouvrait la porte via `OR is_admin(…)`. Une
// fiche publique montre ce que le PUBLIC voit, et rien d'autre ; la prévisualisation, si elle est
// un jour demandée, est un écran d'admin, pas un effet de bord d'authentification.

const BUCKET_MEDIA = "catalog-media";

// "HH:MM:SS" (sérialisation Postgres d'une colonne `time`) → "HH:MM". Le découpage vit dans CETTE
// couche, celle qui possède la forme DB, et nulle part ailleurs : un composant ne doit jamais
// recevoir autre chose qu'une chaîne déjà prête à afficher, sinon la tentation de la recombiner en
// `new Date(\`${fecha}T${hora}\`)` réapparaît — et cet objet serait interprété dans le fuseau du
// navigateur VISITEUR, pas celui de Bogota (spec 18 §0, CLAUDE.md §11.20).
// ⚠️ Le repo porte déjà trois découpages équivalents ailleurs (`toTimeInputValue` ×2 côté admin,
// `toHHMM` dans SlotReservationForm) : c'est de la dette connue, pas un modèle à suivre.
function recortarHora(hora: string | null): string | null {
  return hora ? hora.slice(0, 5) : null;
}

// Template literal SANS interpolation, sur une seule ligne : supabase-js infère le type de retour
// en analysant le type LITTÉRAL de la chaîne. Une concaténation l'élargirait en `string` et ferait
// tomber tout le typage sur `GenericStringError`.
//
// `establishment(...)` ne demande JAMAIS `photo_urls` : la colonne est hors du GRANT SELECT public
// (20260819110000), et la demander ferait échouer la requête ENTIÈRE — pas seulement ce champ.
const COLUMNAS_PRODUCTO = `id, slug, name, description, price_cop, price_tiers, min_qty, max_qty, unit, capacity, unit_count, lodging_kind, type, price_label, external_booking_url, occurrence_type, occurrence_date, recurrence_frequency_days, recurrence_end_date, recurrence_end_count, start_time, duration_minutes, duration_days, program, group_discount_threshold_qty, group_discount_pct, lobby_category_id, online_bookable, evento_capacity_mode, is_free, evento_payment_mode, transport_first_departure_time, transport_last_departure_time, transport_seats_per_departure, transport_departure_address, transport_departure_lat, transport_departure_lon, transport_arrival_address, transport_arrival_lat, transport_arrival_lon, transport_contact_phone, establishment:establishments(id, slug, name, description, address, lobby_last_synced_at, lobby_connector_active, lobby_has_token)`;

/**
 * ⚠️ Mémoïsé par `cache` de React, et ce n'est pas une optimisation : `generateMetadata` et le
 * rendu de la page appellent tous deux cette fonction dans la MÊME requête. Sans le cache, chaque
 * fiche ferait deux fois le tour complet.
 */
export const getProductoPorSlug = cache(
  async (slug: string, { locale }: { locale: string }): Promise<FichaProducto | null> => {
    const supabase = createPublicClient();

    const { data: producto, error } = await supabase
      .from("products")
      .select(COLUMNAS_PRODUCTO)
      .eq("slug", slug)
      .maybeSingle();

    // Une lecture en ÉCHEC n'est jamais une absence : elle lève, la page rend 500 + noindex (même
    // geste que buscar.ts). Un 404 ici, sur une simple panne, dirait aux moteurs de désindexer.
    if (error) throw error;
    // `null` plutôt qu'une exception : la page appelle `notFound()`. Un produit non publié est
    // invisible à `anon` (RLS), donc il arrive ici exactement comme un slug inconnu — c'est la
    // même 404 pour le visiteur, et c'est voulu (jamais un « soft 404 » vers la catégorie).
    if (!producto) return null;

    const esEvento = producto.type === "evento";
    const esEventoReservable = esEvento && Boolean(producto.online_bookable);
    const esAlojamiento = producto.type === "lodging";
    const esTransporte = producto.type === "transport";

    // ⚠️ Calculée UNE SEULE FOIS et réutilisée aux DEUX endroits ci-dessous (le résolveur de mode
    // ET l'objet rendu) : deux expressions séparées finiraient par diverger, et un mode « vitrina »
    // sans `urlExterna` affiche un cul-de-sac muet — le défaut déjà nommé pour les eventos
    // (spec 30 §10.5). Fonction pure exportée plus bas, pour que la garantie soit TESTÉE et pas
    // seulement écrite (CLAUDE.md §11.20).
    const urlContacto = resolverUrlContacto({
      esTransporte,
      urlExterna: producto.external_booking_url,
      telefonoTransporte: producto.transport_contact_phone,
    });
    const esPmsBacked = isPmsBacked({
      type: producto.type,
      lobbyCategoryId: producto.lobby_category_id,
    });

    // LOT B (20260918170000). Un miroir jamais synchronisé pour cet établissement (connecteur tout
    // juste activé) ou silencieusement arrêté (le cron a tourné à vide 8 jours en août sans que
    // personne ne le voie) ne doit JAMAIS être semé tel quel : le client le prendrait pour un
    // calendrier à jour et ne redemanderait rien. Ne rien semer force le fetch de repli côté client
    // (`LodgingReservationForm`, `loadedMonthsRef` vide pour ce mois), qui reverse sa réponse dans
    // le miroir (`night-availability/route.ts`) — la panne se répare au premier visiteur au lieu de
    // rester invisible jusqu'au retour du cron. Garantie extraite en fonction PURE (`esMiroirFresco`
    // ci-dessous) pour être testée sans mock de Supabase — même idiome que `resolverUrlContacto`.
    const miroirFresco = esMiroirFresco(producto.establishment?.lobby_last_synced_at ?? null, Date.now());

    // Connecteur coupé ou sans jeton : `create_order` refuse la ligne (`pms_unavailable`, même
    // condition que `lobby_connector_active and lobby_api_token is not null` — `lobby_has_token` en
    // est le reflet public) et `night-availability` ne peut rien demander. Le logement n'est alors
    // PAS réservable en ligne, et le miroir n'est jamais semé : un calendrier « frais » mènerait
    // droit à ce refus. Les deux colonnes sont accordées à `anon` (20260819110000).
    const conectorPmsActivo = Boolean(
      producto.establishment?.lobby_connector_active && producto.establishment?.lobby_has_token
    );
    const reservableEnLinea = !esPmsBacked || conectorPmsActivo;

    // « Aujourd'hui » = le jour civil à GUATAPÉ, jamais celui d'UTC. Un serveur réglé en UTC fait
    // basculer la date à 19 h heure locale : les `gte("date", …)` retiraient alors du catalogue les
    // créneaux et tarifs de la soirée en cours (lot fuseau, 2026-08-28). Dérivé UNE fois, réutilisé
    // par les trois sites qui en ont besoin.
    const hoyIso = todayInBogota();

    // Un helper par requête plutôt qu'un ternaire dans le tableau : TypeScript infère alors le type
    // de chaque branche ligne par ligne, sans annotation manuelle — et chaque appel démarre sa
    // requête au même tick, donc en vrai parallèle malgré l'`await` interne.
    // ⚠️ UN LOGEMENT PMS-BACKED NE LIT PAS `product_availability` — elle est structurellement vide
    // pour lui (`create_order` saute verrou et décrément, 20260819130000, et le garde-fou
    // 20260913100100 interdit même de l'y matérialiser). Jusqu'au 2026-09-18 il recevait donc un
    // tableau vide et le calendrier arrivait ENTIÈREMENT GRISÉ le temps d'un aller-retour vers
    // LobbyPMS — une fiche qui a l'air complète alors qu'elle charge.
    //
    // Il lit désormais le MIROIR (20260917140000), rafraîchi par cron : une requête SQL locale, dans
    // le même `Promise.all` que le reste de la fiche, donc AUCUN appel réseau supplémentaire et
    // aucune latence ajoutée. Le calendrier est juste dès la première image.
    //
    // La barrière de réservation, elle, ne change pas d'un iota : `POST /api/pms/reserve-nights`
    // interroge Lobby À CHAUD avant toute confirmation et refuse si ça ne colle plus (spec 24 §0 —
    // ce miroir sert à AFFICHER, jamais à décider).
    const leerDisponibilidad = async () =>
      esEvento
        ? { data: [] }
        : esPmsBacked
          ? miroirFresco && conectorPmsActivo
            ? await supabase
                .from("pms_availability_mirror")
                .select("date, available_units, min_stay, max_stay, lead_days")
                .eq("establishment_id", producto.establishment?.id ?? "")
                .eq("lobby_category_id", producto.lobby_category_id ?? -1)
                .gte("date", hoyIso)
                .lte("date", lastBookableDateIso(hoyIso))
                .order("date")
            : { data: [] }
          : await supabase
              .from("product_availability")
              .select("date, capacity, booked")
              .eq("product_id", producto.id)
              .order("date");

    // ⚠️ Le conditionnel est VOLONTAIREMENT différent de celui ci-dessus (`esAlojamiento` en plus) :
    // un hébergement a toujours son écran dédié, quel que soit le nombre de règles de créneaux
    // qu'il pourrait porter. Lui en compter serait une requête gaspillée.
    const contarReglasDeFranja = async () =>
      esEvento || esAlojamiento
        ? { count: 0 }
        : await supabase
            .from("product_slot_rules")
            .select("id", { count: "exact", head: true })
            .eq("product_id", producto.id);

    const leerTarifas = async () =>
      esAlojamiento
        ? await supabase
            .from("product_date_rates")
            .select("date, price_cop")
            .eq("product_id", producto.id)
            .gte("date", hoyIso)
        : { data: [] };

    // Équipements structurés (migration 20260917110000) — même patron conditionnel que
    // leerTarifas/leerDisponibilidad juste au-dessus : réservé au logement, un produit non-lodging
    // ne coûte rien de plus que la fiche d'avant. `resolveLocalizedField`/`asLocalizedField`
    // n'interviennent PAS ici : la résolution se fait après le Promise.all, dans
    // agruparAmenidadesPorCategoria (amenidades.ts) — jamais dans le composant.
    const leerAmenidades = async () =>
      esAlojamiento
        ? await supabase
            .from("product_amenity_assignments")
            .select(
              "amenity:catalog_amenities(label, sort_order, category:catalog_amenity_categories(label, sort_order))"
            )
            .eq("product_id", producto.id)
        : { data: [] };

    // Evento réservable en ligne (2026-09-15) — deux lectures indépendantes de plus, même patron
    // que les helpers ci-dessus : un evento non activé (le cas courant aujourd'hui) ne coûte rien
    // de plus que la fiche d'avant. get_evento_rsvp_counts n'a de sens qu'en mode 'rsvp' (compteur
    // affiché, décision actée — jamais silencieux) ; les 3 autres modes n'ont aucun compteur.
    const leerOcurrenciasEvento = async () =>
      esEventoReservable
        ? await supabase.rpc("get_event_occurrence_availability", {
            p_product_id: producto.id,
            p_from: hoyIso,
            p_to: lastBookableDateIso(hoyIso),
          })
        : { data: [] };

    const leerRsvpEvento = async () =>
      esEventoReservable && producto.evento_capacity_mode === "rsvp"
        ? await supabase.rpc("get_evento_rsvp_counts", {
            p_product_id: producto.id,
            p_from: hoyIso,
            p_to: lastBookableDateIso(hoyIso),
          })
        : { data: [] };

    const lecturas = await Promise.all([
      leerDisponibilidad(),
      contarReglasDeFranja(),
      leerTarifas(),
      supabase
        .from("product_media")
        .select("storage_path")
        .eq("product_id", producto.id)
        .order("sort", { ascending: true }),
      supabase
        .from("establishment_media")
        .select("storage_path")
        .eq("establishment_id", producto.establishment?.id ?? "")
        .order("sort", { ascending: true }),
      leerOcurrenciasEvento(),
      leerRsvpEvento(),
      leerAmenidades(),
    ]);
    // Une sous-lecture en échec lève comme la principale : jamais une fiche amputée (sans photos,
    // calendrier vide) présentée comme complète.
    for (const lectura of lecturas) if ("error" in lectura && lectura.error) throw lectura.error;
    const [
      { data: disponibilidad },
      { count: nbReglasFranja },
      { data: tarifas },
      { data: fotosProducto },
      { data: fotosEstablecimiento },
      { data: ocurrenciasEvento },
      { data: rsvpEvento },
      { data: amenidadesRaw },
    ] = lecturas;

    const amenidades = agruparAmenidadesPorCategoria((amenidadesRaw ?? []) as FilaAmenidad[], locale);

    const modoReserva = resolverModoReserva({
      esEvento,
      esEventoReservable,
      urlExterna: urlContacto,
      esAlojamiento,
      tieneFranjas: (nbReglasFranja ?? 0) > 0,
    });

    // La SEULE attente séquentielle du module, et elle est structurelle : on ne sait qu'ici si le
    // produit est à créneaux. La grouper avec le `Promise.all` demanderait de compter les règles
    // deux fois.
    const lecturaFranjas =
      modoReserva === "slot"
        ? await supabase.rpc("get_product_slots", {
            p_product_id: producto.id,
            p_from: hoyIso,
            p_to: lastBookableDateIso(hoyIso),
          })
        : { data: [] };
    if ("error" in lecturaFranjas && lecturaFranjas.error) throw lecturaFranjas.error;
    const { data: franjas } = lecturaFranjas;

    // Une Map construite UNE fois, jamais un `.find()` par occurrence : l'horizon evento va jusqu'à
    // six mois, soit ~180 occurrences pour un evento quotidien, et la jointure linéaire refaisait
    // alors des milliers de comparaisons à chaque rendu de la fiche pour le même résultat.
    const rsvpPorFecha = new Map(
      (rsvpEvento ?? []).map((fila) => [fila.occurrence_date, fila.registered_qty])
    );

    const urlPublica = (ruta: string) =>
      supabase.storage.from(BUCKET_MEDIA).getPublicUrl(ruta).data.publicUrl;

    const establecimiento = producto.establishment;
    // Plafond par ligne, le même que `create_order` (`coalesce(max_qty, 20)`) : un produit sans
    // plafond saisi reste réservable, borné à 20. Calculé une fois pour tous les formulaires.
    const maxQty = producto.max_qty ?? 20;

    return {
      id: producto.id,
      slug: producto.slug,
      // Un type inconnu ne devrait pas exister (contrainte CHECK), mais le repli évite qu'une
      // valeur ajoutée en base sans passer par le front fasse planter la fiche entière.
      tipo: esTipoOferta(producto.type) ? producto.type : "activity",
      // Repli sur le slug : une fiche sans nom dans aucune langue reste lisible plutôt que vide.
      nombre: resolveLocalizedField(asLocalizedField(producto.name), locale) ?? producto.slug,
      descripcion: resolveLocalizedField(asLocalizedField(producto.description), locale),
      fotos: enFotos(fotosProducto, urlPublica),
      precio: resolverPrecio(producto.price_label, producto.price_cop),
      unidad: producto.unit,
      minQty: producto.min_qty ?? 1,
      maxQty,
      modoReserva,
      urlExterna: urlContacto,
      // Renseignée pour tout evento, INDÉPENDAMMENT du mode : la date d'un événement est une
      // propriété de son type, pas de la façon dont on le réserve. Les confondre était le défaut
      // que la spec 30 corrige (§5b).
      ocurrencia: esEvento
        ? {
            tipo: producto.occurrence_type as "once" | "recurring" | null,
            fecha: producto.occurrence_date,
            frecuenciaDias: producto.recurrence_frequency_days,
            finFecha: producto.recurrence_end_date,
            finConteo: producto.recurrence_end_count,
            hora: producto.start_time,
          }
        : null,
      eventoReservable: esEventoReservable
        ? {
            capacityMode: producto.evento_capacity_mode as "unlimited" | "metered" | "rsvp",
            isFree: producto.is_free,
            paymentMode: producto.evento_payment_mode as "online" | "on_site" | null,
            occurrences: (ocurrenciasEvento ?? []).map((fila) => ({
              date: fila.occurrence_date,
              capacity: fila.capacity,
              booked: fila.booked,
              registeredQty: rsvpPorFecha.get(fila.occurrence_date) ?? null,
            })),
            maxQty,
          }
        : null,
      alojamiento: esAlojamiento
        ? {
            lodgingKind: asLodgingKind(producto.lodging_kind),
            capacity: producto.capacity,
            unitCount: producto.unit_count,
            priceTiers: producto.price_tiers,
            // Le même défaut que l'écran d'origine : un hébergement sans plafond saisi reste
            // réservable, borné à 20.
            maxQty,
            esPmsBacked,
            reservableEnLinea,
            amenidades,
          }
        : null,
      // Transport informatif (migration 20260916150000). Le découpage "HH:MM:SS" → "HH:MM" se fait
      // ICI, dans la couche qui possède la forme DB, et UNE SEULE FOIS : le composant reçoit déjà
      // des chaînes opaques prêtes à afficher, et n'a donc aucune raison de toucher à une heure.
      // C'est ce qui rend structurellement impossible le `new Date(\`${fecha}T${hora}\`)` que la
      // spec 18 §0 interdit (fuseau du navigateur visiteur ≠ Bogota).
      transporte: esTransporte
        ? {
            primeraSalida: recortarHora(producto.transport_first_departure_time),
            ultimaSalida: recortarHora(producto.transport_last_departure_time),
            plazasPorSalida: producto.transport_seats_per_departure,
            salida: {
              direccion: producto.transport_departure_address,
              lat: producto.transport_departure_lat,
              lon: producto.transport_departure_lon,
            },
            llegada: {
              direccion: producto.transport_arrival_address,
              lat: producto.transport_arrival_lat,
              lon: producto.transport_arrival_lon,
            },
          }
        : null,
      duracionDias: producto.duration_days,
      descuentoGrupo:
        producto.group_discount_threshold_qty != null && producto.group_discount_pct != null
          ? {
              umbralPersonas: producto.group_discount_threshold_qty,
              porcentaje: Math.round(producto.group_discount_pct * 100),
            }
          : null,
      // Programme d'un camp (spec 37) — résolu ICI, jamais dans le composant. `resolverPrograma`
      // rend null pour tout type non-camp sans avoir à tester le type : la colonne y est
      // structurellement null (products_program_camp_only).
      programa: resolverPrograma(producto.program, locale),
      // Première salida encore ouverte, pour dater le programme dès le HTML initial — donc pour un
      // crawler comme pour un visiteur qui n'a rien cliqué. `disponibilidad` est déjà filtrée sur
      // `gte("date", hoyIso)` et triée par date plus haut : on prend la première, sans refiltrer.
      primeraSalidaIso: (disponibilidad ?? [])[0]?.date ?? null,
      // CONVERSION UNITÉS LOBBY → CUPOS pour un PMS-backed, exactement la même règle que
      // /api/pms/night-availability : `available_units` compte des chambres/tentes/lits-unités,
      // tout le reste de hifago compte des cupos (`qty`, `min_qty`/`max_qty`, `price_tiers`). Elle
      // est appliquée PAR PRODUIT, jamais en amont — deux produits liés à la même catégorie Lobby
      // peuvent avoir des `lodging_kind`/`capacity` différents, et le miroir est partagé par
      // établissement+catégorie. `booked: 0` parce que le miroir porte déjà le RESTANT, pas un
      // compteur (la soustraction est faite chez Lobby).
      // Seules les nuits sous contrainte NON NULLE, via le même prédicat que la route publique
      // (`hasActiveRestriction`) — jamais une contrainte inventée pour une nuit qui n'en porte pas.
      // Vide sur tous les comptes observés à ce jour, et c'est précisément ce qui rend ce branchement
      // sûr à poser maintenant.
      restriccionesPms: esPmsBacked
        ? (disponibilidad ?? [])
            .map((fila) => {
              const brut = fila as {
                date: string;
                min_stay: number | null;
                max_stay: number | null;
                lead_days: number | null;
              };
              return {
                date: brut.date,
                restrictions: {
                  minStay: brut.min_stay,
                  maxStay: brut.max_stay,
                  leadDays: brut.lead_days,
                },
              };
            })
            .filter((fila) => hasActiveRestriction(fila.restrictions))
        : [],
      disponibilidad: esPmsBacked
        ? (disponibilidad ?? []).map((fila) => {
            const unites = (fila as { date: string; available_units: number }).available_units;
            return {
              date: fila.date,
              capacity:
                unites * cuposPerUnit(asLodgingKind(producto.lodging_kind), producto.capacity),
              booked: 0,
            };
          })
        : ((disponibilidad ?? []) as FilaDisponibilidad[]),
      tarifas: (tarifas ?? []) as FilaTarifa[],
      franjas: (franjas ?? []) as FilaFranja[],
      establecimiento: establecimiento
        ? {
            id: establecimiento.id,
            slug: establecimiento.slug,
            nombre:
              resolveLocalizedField(asLocalizedField(establecimiento.name), locale) ?? "",
            descripcion: resolveLocalizedField(
              asLocalizedField(establecimiento.description),
              locale
            ),
            direccion: establecimiento.address,
            fotos: enFotos(fotosEstablecimiento, urlPublica),
          }
        : null,
      // ⚠️ Prédicat DISTINCT et plus strict que le repli d'affichage ci-dessus : `hasNativeContent`
      // exige une chaîne non blanche. C'est le MÊME que celui du sitemap — deux versions feraient
      // lister des URL que les métadonnées déclarent `noindex`.
      localesNativas: routing.locales.filter((candidate) =>
        hasNativeContent(producto.name, candidate)
      ),
    };
  }
);

/**
 * Ce qui décide du bloc affiché sous le prix.
 *
 * ⚠️ `evento`/`evento_bookable` restent EN TÊTE, délibérément. Le retirer rendrait tout evento sans
 * URL réservable en ligne — un changement de comportement produit que personne n'a demandé. Ce que
 * la spec 30 corrige est l'inverse : que la vitrine ne soit plus RÉSERVÉE aux eventos (cahier §2e,
 * « ce n'est pas réservé aux eventos »). Un evento sans URL ET non réservable en ligne reste donc un
 * cul-de-sac, nommé au §10.5.
 *
 * `evento_bookable` (2026-09-15, evento réservable en ligne) précède `evento` dans le if/else — un
 * evento activé (`online_bookable`) sort du mode vitrine, quel que soit `external_booking_url`
 * (jamais les deux en même temps côté admin, cf. product-type-fields.tsx, mais l'ordre le garantit
 * même si les deux étaient posés).
 *
 * Exporté pour être testable seul : c'est la règle la plus facile à casser par inadvertance.
 */
/**
 * L'URL du bouton de contact d'une fiche — et, pour un transport, la GARANTIE qu'il en a toujours
 * une (décision Jérôme du 2026-09-17 : « normalement il faut juste son num de tel pour contacter »,
 * « non obligatoire le num et sinon c'est celui de hifago »).
 *
 * ⚠️ C'EST CE REPLI QUI FAIT DISPARAÎTRE LE CALENDRIER des fiches de transport, et il faut
 * comprendre pourquoi il vit ici plutôt que dans `resolverModoReserva` juste en dessous :
 * ce dernier bifurque sur la FORME du produit, jamais sur son type — un principe du projet, et
 * `docs/dette-technique.md` note déjà que `search_catalog` fait l'inverse. Lui ajouter un
 * `if (tipo === "transport")` aurait posé une TROISIÈME taxonomie concurrente de « comment ce
 * produit se réserve ». À la place, cette fonction garantit la forme : pour un transport, le
 * dernier terme ne peut jamais être nul, donc `urlExterna` est toujours renseignée, donc le mode
 * vaut toujours `"vitrina"` — sans qu'aucune règle ne connaisse le type.
 *
 * Priorité : l'URL propre du transporteur (son site de réservation) > son WhatsApp > celui de
 * Hifago. Pour tout autre type, le comportement est inchangé : `external_booking_url` ou `null`.
 */
// Seuil de fraîcheur du miroir de disponibilité LobbyPMS (20260918170000) — DÉLIBÉRÉMENT le même
// que le repli de `search_catalog` (20260917150000, même colonne `lobby_last_synced_at`) : un
// partenaire qui réapparaît dans la recherche mais dont la fiche continue de semer un calendrier
// vieux de plusieurs jours serait pire que les deux dégradés séparément.
const SEUIL_FRAICHEUR_MIROIR_MS = 6 * 60 * 60 * 1000;

/**
 * Le miroir de disponibilité (`pms_availability_mirror`) doit-il être semé côté serveur, ou
 * laissé vide pour forcer le fetch de repli côté client ? `ahoraMs` est un paramètre plutôt qu'un
 * `Date.now()` interne — déterministe, donc testable sans faux timers, même choix que
 * `todayInBogota()` ailleurs dans le domaine. Duration entre deux INSTANTS, jamais un jour civil :
 * hors du périmètre de `check-timezone.sh`, qui ne vise que la dérivation d'« aujourd'hui ».
 */
export function esMiroirFresco(lastSyncedAtIso: string | null, ahoraMs: number): boolean {
  if (lastSyncedAtIso == null) return false;
  return ahoraMs - new Date(lastSyncedAtIso).getTime() < SEUIL_FRAICHEUR_MIROIR_MS;
}

export function resolverUrlContacto({
  esTransporte,
  urlExterna,
  telefonoTransporte,
}: {
  esTransporte: boolean;
  urlExterna: string | null;
  telefonoTransporte: string | null;
}): string | null {
  if (!esTransporte) return urlExterna;
  return urlExterna ?? urlDeContacto(telefonoTransporte ?? TELEFONO_HIFAGO);
}

export function resolverModoReserva({
  esEvento,
  esEventoReservable,
  urlExterna,
  esAlojamiento,
  tieneFranjas,
}: {
  esEvento: boolean;
  esEventoReservable: boolean;
  urlExterna: string | null;
  esAlojamiento: boolean;
  tieneFranjas: boolean;
}): ModoReserva {
  // `esEventoReservable` implique déjà `esEvento` chez son unique producteur
  // (`esEvento && Boolean(online_bookable)`) — retester le premier laissait croire à deux conditions.
  if (esEventoReservable) return "evento_bookable";
  if (esEvento) return "evento";
  if (urlExterna !== null) return "vitrina";
  if (esAlojamiento) return "lodging";
  if (tieneFranjas) return "slot";
  return "date";
}

function enFotos(
  filas: { storage_path: string }[] | null,
  urlPublica: (ruta: string) => string
): FotoTarjeta[] {
  return (filas ?? [])
    .map((fila) => fila.storage_path)
    .filter((ruta): ruta is string => typeof ruta === "string" && ruta.length > 0)
    .map((ruta) => ({ url: urlPublica(ruta) }));
}
