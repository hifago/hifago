"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/atoms/Button";
import {
  DayPickerCalendar as Calendar,
  DayPickerCalendarDayButton,
  Input,
  Label,
  TextField,
} from "@hifago/ui";
import {
  addMonthsIso,
  formatCop,
  isMonthWithinHorizon,
  isoDateToLocalMidnight,
  lastBookableDateIso,
  startOfTodayInBogota,
  todayInBogota,
  type LobbyNightRestrictions,
  type LodgingKind,
} from "@hifago/domain";
import { useCart } from "@/lib/cart/CartContext";
import { useAddToCart } from "@/lib/cart/useAddToCart";
import {
  buildInCartNightsMap,
  estimateNightsTotal,
  hasUnavailableNightInRange,
  nightsInRange,
  reachableRangeWindow,
  resolveTierPrice,
  type PriceTier,
} from "@/lib/reservas/reservationRange";
import {
  isoDeFecha,
  nocheDeshabilitada,
  pisoLeadDays,
  ultimoDiaReservable,
} from "@/lib/reservas/calendario";
import { limitarCantidad, topeCantidad } from "@/lib/reservas/cantidad";
import { plazasRestantes } from "@/lib/reservas/disponibilidad";
import { motivoPms } from "@/lib/reservas/pms";
import { usePrefillUltimosCriterios } from "@/lib/reservas/usePrefillUltimosCriterios";
import { Title } from "@/components/atoms/Title";

// Spec 17 §0 Tranche 2, §10 point 6 — react-day-picker mode="range", tranché sur prototype réel
// (cf. docs/journal/2026-08.md). Une seule entité tarifée : le produit lui-même, via
// product_date_rates/price_tiers.
//
// Ce composant a eu un jumeau, HotelReservationForm.tsx, qui ajoutait un sélecteur de chambre
// avant le calendrier. T3 (2026-08-27) a supprimé l'étage hôtel : chaque chambre est devenue un
// produit, et ce formulaire les sert toutes.
type AvailabilityRow = { date: string; capacity: number; booked: number };
type RateRow = { date: string; price_cop: number };

// Une nuit est RÉSERVABLE si son restant couvre la quantité demandée. Seuil `qty`, jamais 0 — une
// nuit à 2 places restantes n'est pas réservable pour 3, même si elle n'est pas complète. Le restant
// passé ici est déjà net du panier en cours (`remainingByDate`). Une nuit ABSENTE de la map n'est
// pas réservable : c'est ce qui couvre la nuit jamais récupérée, acquis du 2026-08-28.
//
// Au niveau module, et pas dans le corps du composant : le compilateur React refuse de préserver une
// mémoïsation dont le résultat est une fonction (react-hooks/preserve-manual-memoization), et une
// fonction stable ici n'a aucune dépendance à déclarer.
// `min_stay` de la nuit d'ARRIVÉE — c'est elle qui commande la longueur du séjour, pas la sortie.
//
// ⚠️ `null` veut dire « Lobby n'a rien dit », JAMAIS « Lobby dit zéro ». Le relevé garde la
// distinction (packages/domain/src/pms/parseLobbyNightCatalog.ts, verrouillé par son test) ; ici on
// choisit un défaut d'APPLICATION — une nuit, le minimum structurel d'un séjour — sans jamais
// réécrire l'observation. Une nuit absente de la map n'a simplement aucune contrainte relevée.
function nuitsMinimumPour(restrictions: Map<string, LobbyNightRestrictions>, arriveeIso: string): number {
  const minStay = restrictions.get(arriveeIso)?.minStay;
  return minStay === null || minStay === undefined ? 1 : minStay;
}

function nuitReservable(restants: Map<string, number>, iso: string, pourQty: number): boolean {
  const restant = restants.get(iso);
  return restant !== undefined && restant >= pourQty;
}

export function LodgingReservationForm({
  productId,
  priceCop,
  priceTiers,
  maxQty,
  lodgingKind,
  isPmsBacked,
  availability,
  restrictedNights = [],
  rates,
}: {
  productId: string;
  priceCop: number;
  priceTiers: PriceTier[] | null;
  maxQty: number;
  lodgingKind: LodgingKind | null;
  isPmsBacked: boolean;
  /**
   * Pour un PMS-backed, ce sont les nuits du MIROIR (pms_availability_mirror), lues côté serveur et
   * déjà converties en cupos — plus un tableau vide comme jusqu'au 2026-09-18. Elles servent de
   * point de départ au calendrier, qui est donc juste dès la première image, sans aucun appel
   * réseau. Un mois absent d'ici est redemandé à LobbyPMS ; c'est devenu le REPLI, plus le chemin
   * nominal.
   */
  availability: AvailabilityRow[];
  /**
   * Les restrictions Lobby (`min_stay`/`max_stay`/`lead_days`) des nuits semées. Elles valent
   * {0,0,0} sur tous les comptes observés à ce jour — mais sans elles, un socio qui poserait un
   * `min_stay` dans son PMS ne le verrait plus appliqué du tout, puisqu'il n'y a plus de fetch au
   * montage pour les rapporter. Un trou silencieux vaut moins qu'un tableau vide.
   */
  restrictedNights?: { date: string; restrictions: LobbyNightRestrictions }[];
  rates: RateRow[];
}) {
  const t = useTranslations("ProductPage");
  const { lines } = useCart();
  const addToCart = useAddToCart();

  // Borne HAUTE de l'horizon produit (six mois, décidé le 2026-08-28). Le `useMemo` reste ici et
  // n'est pas décoratif : react-day-picker doit recevoir la MÊME référence d'un rendu à l'autre.
  const dernierJourReservable = useMemo(() => ultimoDiaReservable(), []);

  const [range, setRange] = useState<DateRange | undefined>();
  const [qty, setQty] = useState(1);

  // Spec 21 §13 — un alojamiento PMS-backed n'a jamais de product_availability peuplée (Lobby fait
  // foi). Depuis le 2026-09-18, `availability` (prop SSR) n'est plus vide pour autant : elle porte
  // les nuits du MIROIR, et le fetch mois par mois n'est plus que le repli — voir le JSDoc de la
  // prop plus haut, qui fait foi.
  //
  // L'ÉTAT EST PAR MOIS, et c'est le correctif du 2026-08-28. Avant, `pmsError` était un booléen
  // GLOBAL au composant (un mois en échec suivi d'un mois réussi effaçait la bannière), et surtout
  // `loadedMonthsRef` marquait le mois « chargé » MÊME EN ÉCHEC : plus rien ne le retentait de toute
  // la session. Comme la panne mesurée est transitoire — novembre est revenu 0, puis 29/30, puis
  // 30/30 — ce qui manquait n'était pas un meilleur message, c'était de REDEMANDER.
  type PmsMonthState =
    | { status: "loading" }
    | { status: "ready" }
    | { status: "error"; reason: string; retryAfterSeconds: number | null };

  // Mois ouvert au premier rendu — et donc CLÉ DU FETCH (`monthKey` juste en dessous, envoyé tel
  // quel à /api/pms/night-availability). C'était le pire des dix sites du lot fuseau : avec
  // `new Date()`, un visiteur européen le 1er du mois à 2 h du matin demandait à LobbyPMS le mois
  // SUIVANT, et le calendrier qu'il regardait n'était jamais celui qu'on venait de charger.
  const [visibleMonth, setVisibleMonth] = useState(() => startOfTodayInBogota());
  // SEMÉ depuis le serveur, plus initialisé vide. C'est ce qui supprime l'aller-retour vers Lobby
  // au chargement : le calendrier a déjà sa donnée, il n'en redemande que ce qui lui manque.
  const [pmsAvailability, setPmsAvailability] = useState<Map<string, AvailabilityRow>>(
    () => new Map(isPmsBacked ? availability.map((row) => [row.date, row]) : [])
  );
  // Les restrictions Lobby de CETTE catégorie, nuit par nuit. Elles sont PAR CATÉGORIE : deux
  // produits d'une même catégorie les partagent, deux catégories du même établissement peuvent
  // différer — d'où une map locale au composant, jamais un cache partagé entre produits.
  const [pmsRestrictions, setPmsRestrictions] = useState<Map<string, LobbyNightRestrictions>>(
    () => new Map(isPmsBacked ? restrictedNights.map((row) => [row.date, row.restrictions]) : [])
  );
  const [pmsMonths, setPmsMonths] = useState<Map<string, PmsMonthState>>(new Map());
  const [attempt, setAttempt] = useState(0);
  // ⚠️ Les mois que le SEMIS couvre déjà sont marqués chargés d'emblée : c'est précisément ce qui
  // empêche le fetch de partir au montage. Le critère est « au moins une nuit », et il suffit parce
  // que `sync_pms_availability_month` remplace le mois ENTIER à chaque passage (delete-puis-insert,
  // 20260917140000) — une seule nuit présente prouve donc que le mois a été synchronisé. Le mois
  // courant est partiel par construction (le serveur filtre les nuits passées), ce qui est
  // exactement ce qu'on veut afficher.
  const loadedMonthsRef = useRef<Set<string>>(
    new Set(isPmsBacked ? availability.map((row) => row.date.slice(0, 7)) : [])
  );
  // ⚠️ Le chargement PMS ATTEND que le pré-remplissage ait tranché. Les effets partent dans l'ordre
  // de déclaration : sans cette garde, le mois COURANT était demandé au montage, puis le
  // pré-remplissage posait `visibleMonth` sur le mois recherché et la première réponse était jetée
  // (`if (cancelled) return`). Un aller-retour réseau entier gaspillé par visite venant d'une
  // recherche datée — et, hors fenêtre de cache de 60 s, un vrai appel LobbyPMS sur un quota de
  // 60/min. Un rendu de plus contre une requête de moins.
  const [prefillResuelto, setPrefillResuelto] = useState(false);

  const monthKey = useMemo(() => format(visibleMonth, "yyyy-MM"), [visibleMonth]);

  // Les mois que le calendrier doit connaître : celui qu'il AFFICHE, et le SUIVANT.
  //
  // ⚠️ Le second n'est pas du confort. `showOutsideDays` est actif (packages/ui), donc la grille
  // montre toujours les premiers jours du mois suivant — et la route ne sert QU'UN mois. Ces
  // jours-là étaient donc absents de `pmsAvailability`, et `nocheDeshabilitada` les désactive par
  // omission (fail-closed, acquis du 2026-08-28). Mesuré le 2026-09-17 : une plage du 30 septembre
  // au 2 octobre était refusée SANS un mot, et rien n'indiquait qu'il fallait paginer d'abord. Le
  // fail-closed reste juste — c'est de ne pas avoir la donnée qui était faux.
  //
  // Coût : un appel LobbyPMS de plus par (établissement, mois) — jamais par visiteur ni par
  // produit, la clé de cache de la route étant `établissement:mois`. Un second logement du même
  // établissement ne paie donc rien de plus.
  //
  // Le mois PRÉCÉDENT n'est délibérément pas préchargé : ses jours débordants ouvrent la grille,
  // ils sont donc presque toujours dans le passé, déjà désactivés pour cette raison-là.
  const moisACharger = useMemo(() => {
    const suivant = addMonthsIso(`${monthKey}-01`, 1).slice(0, 7);
    // L'horizon produit est refusé en 400 par la route (`month_out_of_range`) : demander un mois
    // hors horizon allumerait le bandeau d'erreur pour une simple limite de vente.
    return [monthKey, suivant].filter((mois) => isMonthWithinHorizon(mois));
  }, [monthKey]);

  useEffect(() => {
    if (!isPmsBacked || !prefillResuelto) return;
    // Un mois déjà obtenu ne se redemande jamais : `loadedMonthsRef` est ce qui rend le
    // préchargement gratuit à la navigation (revenir en arrière ne relance rien).
    const aCharger = moisACharger.filter((mois) => !loadedMonthsRef.current.has(mois));
    if (aCharger.length === 0) return;

    let cancelled = false;
    // L'état est tenu PAR MOIS, et c'est ce qui permet de précharger sans rien changer à l'écran :
    // le bandeau ne lit que `pmsMonths.get(monthKey)`, donc un mois préchargé qui échoue reste
    // silencieux jusqu'à ce qu'on navigue dessus.
    const setMonth = (mois: string, state: PmsMonthState) =>
      setPmsMonths((prev) => new Map(prev).set(mois, state));

    for (const mois of aCharger) {
      setMonth(mois, { status: "loading" });

      fetch(`/api/pms/night-availability?productId=${encodeURIComponent(productId)}&month=${mois}`)
        .then(
          (response) =>
            response.json() as Promise<{
              ok: boolean;
              nights?: AvailabilityRow[];
              restrictedNights?: { date: string; restrictions: LobbyNightRestrictions }[];
              reason?: string;
              retryAfterSeconds?: number | null;
            }>
        )
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            // Le mois n'est VOLONTAIREMENT pas ajouté à loadedMonthsRef : il doit rester retentable.
            setMonth(mois, {
              status: "error",
              reason: result.reason ?? "pms_unreachable",
              retryAfterSeconds: result.retryAfterSeconds ?? null,
            });
            return;
          }
          loadedMonthsRef.current.add(mois);
          setPmsAvailability((prev) => {
            const next = new Map(prev);
            for (const row of result.nights ?? []) next.set(row.date, row);
            return next;
          });
          // Le tableau ne porte QUE les nuits sous contrainte non nulle : vide sur tous les comptes
          // observés à ce jour, donc ce bloc est un no-op aujourd'hui — et c'est exactement pourquoi
          // le poser maintenant est sûr.
          setPmsRestrictions((prev) => {
            const next = new Map(prev);
            for (const row of result.restrictedNights ?? []) next.set(row.date, row.restrictions);
            return next;
          });
          setMonth(mois, { status: "ready" });
        })
        .catch(() => {
          if (!cancelled) {
            setMonth(mois, { status: "error", reason: "pms_unreachable", retryAfterSeconds: null });
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [isPmsBacked, prefillResuelto, moisACharger, productId, attempt]);

  const monthState = pmsMonths.get(monthKey);
  // CE QU'ON FAIT DE L'ÉCHEC — une seule table, dans `lib/reservas/pms.ts`. La décision vivait en
  // DEUX morceaux ici (un booléen `reason !== "connector_inactive"`, un ternaire dans le JSX), et
  // la route émet DIX motifs : les huit autres héritaient de « réessayer » sans que personne ne
  // l'ait décidé. Spec 30 §7a.
  const motivo = monthState?.status === "error" ? motivoPms(monthState.reason) : null;
  const cargando = monthState?.status === "loading";

  const effectiveAvailability = useMemo(
    () => (isPmsBacked ? [...pmsAvailability.values()] : availability),
    [isPmsBacked, pmsAvailability, availability]
  );

  const byDate = useMemo(
    () => new Map(effectiveAvailability.map((row) => [row.date, row])),
    [effectiveAvailability]
  );
  const rateByDate = useMemo(() => new Map(rates.map((row) => [row.date, row.price_cop])), [rates]);

  // Cupos déjà occupés par CE produit dans le panier en cours (pas encore en base) — même
  // raisonnement que ReservationForm.tsx (avertissement indicatif, jamais la vraie barrière, qui
  // reste create_order au moment du checkout). Filtré par productId, qui suffit à désambiguïser :
  // product_availability est propre à CE produit.
  const inCartByDate = useMemo(
    () =>
      buildInCartNightsMap(
        lines,
        (line) => line.productId === productId,
        (_line, night) => night
      ),
    [lines, productId]
  );

  const qtyMax = topeCantidad(maxQty);

  // Cupos restants par nuit — une seule dérivation, lue par le barré du calendrier ET par le
  // compteur affiché dans la case. Ne dépend PAS de `qty` : c'est un fait de disponibilité, pas un
  // verdict sur la demande en cours.
  const remainingByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of effectiveAvailability) {
      map.set(row.date, plazasRestantes(row, inCartByDate.get(row.date) ?? 0));
    }
    return map;
  }, [effectiveAvailability, inCartByDate]);

  // Nuits que la quantité demandée ne peut pas prendre. Le seuil est `qty`, jamais 0 — c'est le
  // correctif du 2026-08-28. Avant, le calendrier ne barrait que les nuits COMPLÈTES : une nuit à 2
  // places restantes s'affichait normale, se laissait sélectionner, et n'était refusée qu'après
  // coup par range-unavailable-warning. Le verdict arrivait donc APRÈS le choix au lieu de le
  // guider, et rien ne disait quelle nuit coinçait ni combien il restait.
  const unavailableDates = useMemo(() => {
    const dates: Date[] = [];
    for (const [date, remaining] of remainingByDate) {
      if (remaining < qty) dates.push(parseISO(date));
    }
    return dates;
  }, [remainingByDate, qty]);

  // Bornes des deux marches : jamais avant aujourd'hui à Guatapé, jamais au-delà de l'horizon
  // produit (six mois, inclusif). Mêmes bornes que `startMonth`/`endMonth` et que les deux
  // matchers `before`/`after` du calendrier — une seule vérité, trois expressions.
  // `lead_days` — LE PLANCHER QUI MONTE, pas des nuits à barrer une par une (le délai de
  // réservation est une propriété de la catégorie, pas de telle ou telle nuit). On retient le
  // MAXIMUM des valeurs non nulles relevées : si deux nuits annonçaient des délais différents, le
  // plus strict est le seul qui ne propose jamais une nuit que Lobby refuserait.
  //
  // ⚠️ `null` est ignoré, pas lu comme 0 — « Lobby n'a rien dit » n'apporte aucune contrainte.
  const plancherIso = useMemo(() => pisoLeadDays(pmsRestrictions, todayInBogota()), [pmsRestrictions]);

  // Le même plancher, sous la forme qu'attend le matcher `before` de react-day-picker. À
  // `lead_days = 0` il vaut exactement `startOfTodayInBogota()` — d'où l'absence totale d'effet
  // aujourd'hui, sur des restrictions mesurées à {0,0,0}.
  const plancher = useMemo(() => isoDateToLocalMidnight(plancherIso), [plancherIso]);

  const bornesCalendrier = useMemo(
    () => ({ firstIso: plancherIso, lastIso: lastBookableDateIso() }),
    [plancherIso]
  );

  // Spec 28 §4 point 3 : la plage filtrée dans la recherche, si elle tient dans l'horizon de ce
  // produit, est déjà posée en arrivant sur la fiche — `visibleMonth` suit pour que la grille
  // ouvre directement sur ce mois. Seule validation faite ICI : les bornes de l'horizon. Ce n'est
  // plus faute de données — depuis le semis du 2026-09-18, `pmsAvailability` et `pmsRestrictions`
  // sont déjà remplies au premier rendu dans le cas nominal — mais parce que le REPLI reste
  // asynchrone : miroir vide, cron arrêté, ou mois hors semis. `hasUnavailableNightInRange` et le
  // bandeau `range-unavailable-warning` restent donc le filet, exactement comme pour un clic réel
  // sur un mois pas encore chargé.
  usePrefillUltimosCriterios(({ desde, hasta }) => {
    // ⚠️ `setPrefillResuelto(true)` sur TOUS les chemins, y compris ceux qui ne pré-remplissent
    // rien : c'est ce drapeau qui débloque le chargement PMS plus haut. L'oublier sur une branche
    // laisserait le calendrier d'un produit PMS vide pour toujours.
    setPrefillResuelto(true);
    if (!desde || !hasta || desde === hasta) return; // un seul jour ne fait jamais une nuit
    if (desde < bornesCalendrier.firstIso || hasta > bornesCalendrier.lastIso) return;
    setRange({ from: isoDateToLocalMidnight(desde), to: isoDateToLocalMidnight(hasta) });
    setVisibleMonth(isoDateToLocalMidnight(desde));
  });

  const ancreIso = useMemo(() => isoDeFecha(range?.from), [range]);

  // LA FENÊTRE ATTEIGNABLE — correctif du 2026-08-29, cf. l'en-tête de reachableRangeWindow.
  //
  // ⚠️ L'ancre est `range.from`, y compris quand la plage est COMPLÈTE. Ce n'est pas un raccourci :
  // `addToRange` (react-day-picker) ré-étend une plage complète au reclic — un clic avant `from`
  // donne {from: clic, to}, un clic après donne {from, to: clic}. Calculer la fenêtre depuis
  // `range.from` couvre donc aussi ce reclic, sans cas particulier.
  //
  // ⚠️ Et c'est bien `range.from`, pas « from posé et to absent » : RDP 10 pose {from: X, to: X} au
  // PREMIER clic, jamais {from: X, to: undefined}. Une détection par `!range.to` ne se déclencherait
  // jamais — vérifié, c'est ce qui a fait échouer la première version de ce correctif.
  // Les trois adaptateurs de `reachableRangeWindow` (nuit réservable, bornes du calendrier,
  // min_stay de l'arrivée) étaient recopiés à l'identique aux TROIS sites d'appel, avec pour seule
  // variation la quantité. Ils vivent ici une fois : ajouter un paramètre à la fonction de domaine
  // ne demande plus de mettre trois sites à jour en cadence, ce qu'un copier-coller rate en silence.
  const fenetreDepuis = useCallback(
    (ancre: string, pourQty: number) =>
      reachableRangeWindow(
        ancre,
        (nuit) => nuitReservable(remainingByDate, nuit, pourQty),
        bornesCalendrier,
        (arrivee) => nuitsMinimumPour(pmsRestrictions, arrivee)
      ),
    [remainingByDate, bornesCalendrier, pmsRestrictions]
  );

  const fenetreAtteignable = useMemo(
    () => (ancreIso ? fenetreDepuis(ancreIso, qty) : null),
    [ancreIso, fenetreDepuis, qty]
  );

  // PHASE 1, mémoïsée PAR DATE. react-day-picker évalue le prédicat `disabled` une fois par CASE
  // (~42) et à CHAQUE rendu — donc à chaque frappe dans le champ quantité, à chaque survol qui
  // change un état voisin. Or chaque évaluation marche jusqu'à la première nuit non réservable,
  // c'est-à-dire potentiellement jusqu'à l'horizon de six mois sur un logement largement ouvert.
  // Ce cache ramène le coût à un calcul par date DISTINCTE et par jeu de dépendances, au lieu d'un
  // par case et par rendu. Il se vide dès qu'une dépendance change, donc il ne peut jamais servir
  // une fenêtre périmée — et s'il était rejeté par React, on retomberait simplement sur l'ancien
  // coût, jamais sur un résultat faux.
  // ⚠️ CONSTRUITE EN UNE FOIS, jamais mutée ensuite : le compilateur React refuse toute
  // modification d'une valeur issue de `useMemo` (« This value cannot be modified »), donc le cache
  // paresseux qu'on écrirait spontanément ici est illégal. On calcule d'avance, pour les seules
  // dates que le calendrier peut proposer comme arrivée — celles dont on a reçu la disponibilité.
  //
  // ⚠️ BORNÉ AUX MOIS AFFICHABLES depuis le semis du 2026-09-18, et ce n'est pas une micro-optim :
  // `remainingByDate` portait un mois (~30 dates), elle en porte maintenant sept (~200). Or chaque
  // entrée appelle `reachableRangeWindow`, qui marche en avant jusqu'à la première nuit bloquante
  // ou la fin de l'horizon — donc ce cache est en O(N²), et il se recalcule à CHAQUE frappe dans le
  // champ quantité (`qty` est dans ses dépendances). Mesuré : 0,7 ms à un mois, 22 ms à sept, sur un
  // Mac — soit 100 à 200 ms de blocage du thread principal par frappe sur un mobile milieu de gamme.
  // Le calendrier n'affiche qu'un mois à la fois : pré-calculer les six autres ne sert personne, et
  // une date hors cache reste couverte par `calculerFenetre` (le repli que `nocheDeshabilitada`
  // appelle déjà pour toute date qu'il ne trouve pas ici). Mois voisins inclus pour les jours
  // débordants de la grille.
  const fenetresParArrivee = useMemo(() => {
    const moisAffichables = new Set([
      addMonthsIso(`${monthKey}-01`, -1).slice(0, 7),
      monthKey,
      addMonthsIso(`${monthKey}-01`, 1).slice(0, 7),
    ]);
    const par = new Map<string, ReturnType<typeof fenetreDepuis>>();
    for (const iso of remainingByDate.keys()) {
      if (moisAffichables.has(iso.slice(0, 7))) par.set(iso, fenetreDepuis(iso, qty));
    }
    return par;
  }, [remainingByDate, fenetreDepuis, qty, monthKey]);

  // Compteur de restant dans la case du jour. Affiché UNIQUEMENT quand il contraint réellement le
  // choix (`remaining < qtyMax`) : sur un logement à 20 cupos ouverts tous les jours, imprimer
  // « 20 » sur trente cases n'informe personne et abîme la lecture du calendrier.
  //
  // Mémoïsé sur la map, et c'est indispensable : react-day-picker démonte et remonte toute la
  // grille quand le TYPE du composant `DayButton` change (cf. la doc de
  // dateTaggedDayButtonComponents dans packages/ui/src/components/legacy-calendar.tsx, qui existe
  // précisément pour ça). Recréer ce type à chaque frappe dans le champ quantité aurait défait
  // exactement l'optimisation qu'elle documente. `data-date` est repris tel quel : c'est la cible
  // stable des tests e2e, indépendante de la locale d'affichage.
  const dayButtonComponents = useMemo(() => {
    function RemainingDayButton(props: ComponentProps<typeof DayPickerCalendarDayButton>) {
      const iso = format(props.day.date, "yyyy-MM-dd");
      const remaining = remainingByDate.get(iso);
      return (
        <DayPickerCalendarDayButton {...props} data-date={iso}>
          {props.children}
          {remaining !== undefined && remaining > 0 && remaining < qtyMax ? (
            <span data-testid="night-remaining">{remaining}</span>
          ) : null}
        </DayPickerCalendarDayButton>
      );
    }
    return { DayButton: RemainingDayButton };
  }, [remainingByDate, qtyMax]);

  const nights = useMemo(() => nightsInRange(range), [range]);
  const hasUnavailableNight = hasUnavailableNightInRange(
    nights,
    qty,
    (night) => byDate.get(night),
    (night) => inCartByDate.get(night) ?? 0
  );

  const canAdd = nights.length > 0 && !hasUnavailableNight;

  // Estimation d'affichage (jamais la vraie barrière) : palier de quantité déjà résolu côté client
  // (mécanique publique, pas de secret) puis override exact par nuit si posé côté admin —
  // stay_rates (saison/week-end) volontairement ignoré ici, mêmes raisons que
  // HotelReservationForm.tsx : create_order reste la seule source de vérité du total réellement
  // facturé, cf. CartLine.priceCop.
  const estimatedUnitPriceCop = useMemo(() => {
    if (nights.length === 0) return 0;
    const tierPrice = resolveTierPrice(priceTiers, priceCop, qty);
    return estimateNightsTotal(nights, tierPrice, (night) => rateByDate.get(night));
  }, [nights, qty, priceTiers, priceCop, rateByDate]);

  // La quantité N'EST PLUS remise à 1 ici. Elle l'était à chaque clic sur le calendrier, ce qui
  // rendait impossible le seul geste qui compte : poser d'abord le nombre de places, puis regarder
  // quelles nuits l'acceptent. Le champ est désormais saisissable AVANT les dates, et sa valeur
  // survit à la sélection.
  function handleSelectRange(next: DateRange | undefined) {
    setRange(next);
  }

  // Monter la quantité peut invalider une plage DÉJÀ posée, sans qu'aucun clic n'ait eu lieu sur
  // le calendrier — c'est le seul chemin restant par lequel `hasUnavailableNightInRange` pourrait
  // encore parler. On replie plutôt que d'avertir : la fenêtre resserrée est visible à l'écran
  // dans le même geste, et l'utilisateur repique une sortie dedans.
  function handleQtyChange(value: string) {
    const brut = Number(value);
    // min fixé à 1, jamais products.min_qty : create_order ne le vérifie que hors lodging (le
    // plafond lodging est l'agrégat lodging_cap_exceeded, sans rapport) — cf. lib/reservas/cantidad.ts.
    const suivant = limitarCantidad(brut, 1, qtyMax);
    setQty(suivant);
    if (!range?.from) return;

    const fenetre = fenetreDepuis(format(range.from, "yyyy-MM-dd"), suivant);
    // La nuit d'arrivée elle-même ne tient plus la quantité : il n'y a plus de fenêtre à rétrécir,
    // on repart d'une sélection vide.
    if (!fenetre) {
      setRange(undefined);
      return;
    }
    // La sortie déborde la nouvelle fenêtre : on replie sur l'arrivée, qui redevient l'ancre.
    if (range.to && format(range.to, "yyyy-MM-dd") > fenetre.toIso) {
      setRange({ from: range.from, to: range.from });
    }
  }

  // Spec 28 Tranche 3 : sur succès, `useAddToCart` redirige déjà vers l'accueil — il n'y a plus
  // rien à faire ici avec la valeur de retour (ni toast, ni reset local : le composant est sur le
  // point de se démonter).
  async function handleAddToCart() {
    if (!range?.from || !range?.to || !canAdd) return;
    await addToCart({
      productId,
      date: format(range.from, "yyyy-MM-dd"),
      endDate: format(range.to, "yyyy-MM-dd"),
      qty,
    });
  }

  // Nommer l'unité de `qty` là où elle se saisit. « Cantidad » ne disait pas de QUOI, alors que la
  // réponse dépend du produit : un dortoir se vend au lit, une privée ou une maison à l'unité (même
  // règle que cuposPerUnit et que le garde-fou capacity_exceeds_physical). `lodging_kind` étant
  // facultatif, l'intitulé neutre reste le repli.
  const quantityLabel =
    lodgingKind === "dorm"
      ? t("quantityLabelBeds")
      : lodgingKind === "private"
        ? t("quantityLabelRooms")
        : lodgingKind === "whole_house"
          ? t("quantityLabelHouses")
          : t("quantityLabel");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Title as="h2" size="bloque">
          {t("availabilityTitle")}
        </Title>
        {monthState?.status === "error" ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-danger" role="alert" data-testid="pms-availability-error">
              {t(motivo?.claveI18n ?? "pmsAvailabilityError")}
            </p>
            {motivo?.reintentable ? (
              <Button
                size="sm"
                variant="solid"
                color="neutral"
                testId="pms-availability-retry"
                onPress={() => setAttempt((value) => value + 1)}
              >
                {t("pmsAvailabilityRetry")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {cargando ? (
          <p className="text-sm text-muted" aria-live="polite" data-testid="pms-availability-loading">
            {t("pmsAvailabilityLoading")}
          </p>
        ) : null}
        {/* ⚠️ LE CLIC PERDU, corrigé le 2026-09-17. Pendant qu'un mois est en vol, tous ses jours
            sont `disabled` (une nuit absente n'est pas réservable — fail-closed du 2026-08-28) :
            un clic sur la date de sortie juste après avoir paginé ne faisait donc RIEN, sans
            erreur, et la case s'activait une seconde plus tard. Le préchargement du mois suivant
            supprime le cas dominant ; il reste la toute première ouverture et un réseau lent.
            La grille dit maintenant qu'elle n'est pas prête, au lieu de se laisser cliquer dans le
            vide. Délibérément PAS de mémorisation du clic pour le rejouer ensuite : un clic qui
            s'applique une seconde plus tard sur une grille qui a changé surprend davantage qu'un
            clic perdu. `aria-busy` porte l'information pour un lecteur d'écran, l'opacité pour
            les autres. */}
        <div aria-busy={cargando} className={cargando ? "transition-opacity opacity-60" : "transition-opacity"}>
          <Calendar
            mode="range"
            selected={range}
            onSelect={handleSelectRange}
            month={visibleMonth}
            onMonthChange={setVisibleMonth}
            // La NAVIGATION elle-même est bornée, pas seulement la sélection : `visibleMonth` pilote
            // la clé du fetch, et la route refuse en 400 `month_out_of_range` tout mois hors horizon.
            // Sans ces deux bornes, paginer au septième mois affichait une erreur de disponibilité
            // pour ce qui n'est en réalité qu'une limite de vente.
            startMonth={startOfTodayInBogota()}
            endMonth={dernierJourReservable}
            // Le jour « aujourd'hui » mis en avant par react-day-picker vient sinon de son propre
            // `dateLib.today()` = `new Date()` du runtime (DayPicker.js:167), donc du NAVIGATEUR.
            // Sans cette prop, le correctif de `disabled` ci-dessous et le surlignage se
            // contrediraient pour un visiteur hors Colombie : le 27 resterait cliquable mais le 28
            // serait peint comme « aujourd'hui ».
            today={startOfTodayInBogota()}
            // SYMÉTRIE AFFICHAGE / VERDICT, corrigée le 2026-08-28. `hasUnavailableNightInRange`
            // traite depuis toujours une nuit ABSENTE comme indisponible ; l'affichage, lui, ne
            // regardait que les nuits REÇUES — une nuit jamais résolue s'affichait donc normale et
            // cliquable, et n'était refusée qu'après la sélection. La règle existait déjà une porte à
            // côté, dans ReservationForm : on la reprend, on ne l'invente pas. Vaut aussi pour le
            // chemin non-PMS, où le même trou existait sans que personne ne l'ait vu.
            disabled={[
              // Minuit à GUATAPÉ, jamais l'heure du NAVIGATEUR (lot fuseau, 2026-08-28) : un visiteur
              // européen ouvrant la fiche le 1er du mois à 2 h du matin voyait le dernier jour du mois
              // précédent barré, alors qu'à Guatapé il était encore réservable.
              { before: plancher },
              // Borne HAUTE : au-delà de l'horizon produit, rien n'est vendable. Sans elle, ces
              // dates paraissaient sélectionnables et n'étaient refusées qu'après coup.
              { after: dernierJourReservable },
              // Le prédicat vit dans `lib/reservas/calendario.ts` — trente lignes qui ne lisaient
              // AUCUN état React et n'étaient donc testables qu'en montant un calendrier entier.
              // Même polarité que `disabled` (true = désactivé) : aucune négation à ce site, une
              // négation ici serait la façon la plus discrète de rouvrir l'enjambement.
              (date) =>
                nocheDeshabilitada(format(date, "yyyy-MM-dd"), {
                  ancreIso,
                  fenetreAtteignable,
                  fenetresParArrivee,
                  calculerFenetre: (iso) => fenetreDepuis(iso, qty),
                }),
            ]}
            modifiers={{ unavailable: unavailableDates }}
            modifiersClassNames={{ unavailable: "line-through opacity-60" }}
            components={dayButtonComponents}
          />
        </div>
      </div>

      {nights.length > 0 ? (
        hasUnavailableNight ? (
          <p className="text-sm text-danger" role="alert" data-testid="range-unavailable-warning">
            {t("rangeUnavailable")}
          </p>
        ) : (
          <p className="text-sm text-muted" aria-live="polite">
            {t("nightsCount", { count: nights.length })}
          </p>
        )
      ) : (
        <p className="text-sm text-muted">{t("selectRange")}</p>
      )}

      {/* Plus de `isDisabled` : le champ se saisit avant les dates, c'est tout l'intérêt du
          correctif — le calendrier se barre au fur et à mesure qu'on monte la quantité. */}
      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        onChange={handleQtyChange}
      >
        <Label>{quantityLabel}</Label>
        <Input id="qty" type="number" min={1} max={qtyMax} data-testid="lodging-qty-input" />
      </TextField>

      {canAdd ? (
        <p className="text-sm font-medium" data-testid="lodging-estimated-price">
          {t("estimatedTotal")}: {formatCop(estimatedUnitPriceCop * qty)}
        </p>
      ) : null}

      <Button size="lg" testId="add-to-cart-button" onPress={handleAddToCart} isDisabled={!canAdd}>
        {t("addToCart")}
      </Button>
    </div>
  );
}
