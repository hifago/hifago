"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/atoms/Button";
import { Aviso } from "@/components/molecules/Aviso";
import { TarjetaOferta } from "@/components/molecules/TarjetaOferta";
import type { Locale } from "@/messages";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";

// La liste d'offres d'une page de listing, et son défilement (2026-09-08, spec 29 §5d —
// décisions 11 et 12).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CE COMPOSANT NE FAIT PAS : la première page
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Il reçoit `tarjetasIniciales` en props et n'en demande AUCUNE au montage. C'est le serveur qui
// rend la première page (spec 29 §0, invariant 6) : c'est ce qu'un crawler lit, c'est ce qui porte
// le LCP, et c'est ce qui s'affiche si le JavaScript n'arrive jamais. Le défilement n'ajoute que
// la SUITE.
//
// ⚠️ ASYMÉTRIE VOULUE ENTRE LA PAGE ET LE PONT. Ouvrir `?pagina=3` fait rendre au serveur les
// TROIS pages d'un coup (sinon la liste commencerait au milieu de rien) ; le pont
// `/api/catalogo/listado`, lui, rend UNE tranche à la fois — c'est ce qu'on ajoute en bas. Les deux
// lisent la même fonction, avec des bornes différentes.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LES TROIS PIÈGES DU DÉFILEMENT INFINI, ET CE QU'ON EN FAIT
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. **Le clavier et les lecteurs d'écran.** Un observateur d'intersection ne se déclenche jamais
//    pour qui ne fait pas défiler à la souris. Le bouton « Cargar más » n'est donc PAS un repli
//    qui apparaît quand l'observateur échoue : il est rendu en permanence tant qu'il reste des
//    offres, et c'est lui le chemin garanti.
// 2. **Le pied de page qui recule.** Coût assumé de la décision 11 : chaque chargement repousse le
//    bas de page. Documenté au §10 de la spec, sans effet tant que le pied ne porte aucun lien —
//    les routes légales sont repoussées (spec 27 §0).
// 3. **La panne silencieuse.** Un échec du pont ne doit pas se lire « il n'y a plus rien » : la
//    liste garde ce qu'elle a, la région d'état le dit, et le bouton reste cliquable.

export type ListadoInfinitoProps = {
  /** La première page, RENDUE PAR LE SERVEUR. */
  tarjetasIniciales: OfertaTarjeta[];
  /** Le total avant pagination — il alimente le décompte. */
  total: number;
  hayMasInicial: boolean;
  /** La page atteinte à l'arrivée : 1, ou ce que `?pagina=` portait. */
  paginaInicial: number;
  /**
   * L'URL du pont, critères compris, SANS `pagina` — le composant y ajoute `&pagina=N`.
   * Construite par la page : elle seule connaît le type, le tag et les critères lus dans l'URL.
   */
  endpointBase: string;
  locale: Locale;
  testId?: string;
};

export function ListadoInfinito({
  tarjetasIniciales,
  total,
  hayMasInicial,
  paginaInicial,
  endpointBase,
  locale,
  testId = "listado",
}: ListadoInfinitoProps) {
  const t = useTranslations("ListadoPage");

  const [tarjetas, setTarjetas] = useState(tarjetasIniciales);
  const [pagina, setPagina] = useState(paginaInicial);
  const [hayMas, setHayMas] = useState(hayMasInicial);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);

  // ⚠️ RESYNCHRONISATION SUR LES PROPS, même piège que `BuscadorInicio` (spec 28 §10bis point 6).
  // React conserve l'état d'un composant monté et l'initialiseur de `useState` ne rejoue pas : une
  // navigation vers la MÊME route avec d'autres critères (le bouton « précédent », un lien de
  // catégorie voisine) re-rendrait la page côté serveur pendant que cette liste continuerait
  // d'afficher les offres de la recherche précédente — et le décompte mentirait avec elle.
  //
  // La comparaison porte sur `endpointBase`, qui EST la signature de la requête (type, tag,
  // critères) — jamais sur le tableau `tarjetasIniciales`, recréé à chaque rendu et donc toujours
  // différent par référence : le comparer effacerait à chaque rendu les pages déjà chargées.
  const [firma, setFirma] = useState(endpointBase);
  if (firma !== endpointBase) {
    setFirma(endpointBase);
    setTarjetas(tarjetasIniciales);
    setPagina(paginaInicial);
    setHayMas(hayMasInicial);
    setFallo(false);
  }

  const cargarMas = useCallback(async () => {
    if (cargando || !hayMas) return;
    setCargando(true);
    setFallo(false);
    const siguiente = pagina + 1;
    try {
      const reponse = await fetch(`${endpointBase}&pagina=${siguiente}`);
      // ⚠️ Sans ce `throw`, une réponse d'erreur (qui ne porte PAS de clé `tarjetas`, par
      // construction du pont) partirait en `TypeError` au `map` suivant — donc sur l'écran
      // d'erreur, alors que la panne est parfaitement rattrapable ici. C'est exactement le trou
      // trouvé le 2026-09-08 sur le pont des suggestions.
      if (!reponse.ok) throw new Error(`listado: ${reponse.status}`);
      const cuerpo = (await reponse.json()) as {
        tarjetas: OfertaTarjeta[];
        hayMas: boolean;
      };
      setTarjetas((previas) => [...previas, ...cuerpo.tarjetas]);
      setHayMas(cuerpo.hayMas);
      setPagina(siguiente);

      // ⚠️ `replaceState`, JAMAIS `pushState` (décision 12). Chaque page chargée empilerait sinon
      // une entrée d'historique, et le bouton « précédent » ferait remonter la liste tranche par
      // tranche au lieu de ramener le visiteur d'où il vient. L'URL courante est la source : on ne
      // la reconstruit pas, on y pose un paramètre.
      const url = new URL(window.location.href);
      url.searchParams.set("pagina", String(siguiente));
      window.history.replaceState(null, "", url);
    } catch (erreur) {
      // La liste garde ce qu'elle affiche. Dégradé côté visiteur, jamais côté journal.
      console.error("[listado] échec du chargement de la page suivante", erreur);
      setFallo(true);
    } finally {
      setCargando(false);
    }
  }, [cargando, hayMas, pagina, endpointBase]);

  // L'observateur lit toujours la DERNIÈRE version de `cargarMas` sans être recréé à chaque rendu :
  // le reconstruire à chaque changement d'état le ferait se déclencher à nouveau sur une sentinelle
  // déjà visible, et enchaîner les pages sans que personne n'ait défilé.
  //
  // ⚠️ La synchronisation passe par un effet, jamais par une affectation pendant le rendu —
  // `react-hooks/refs` l'a refusée, à juste titre : écrire une ref pendant le rendu casse la
  // promesse qu'un rendu est pur, et React 19 peut en jeter un et le rejouer.
  const cargarMasRef = useRef(cargarMas);
  useEffect(() => {
    cargarMasRef.current = cargarMas;
  }, [cargarMas]);

  const sentinela = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nodo = sentinela.current;
    // ⚠️ La garde n'est pas défensive pour rien : `IntersectionObserver` n'existe pas dans jsdom
    // (donc dans les tests de ce fichier) ni dans un très vieux navigateur. Sans elle, le composant
    // lèverait au montage. Avec elle, il dégrade exactement comme prévu — le bouton reste, et c'est
    // le chemin garanti de toute façon.
    if (!nodo || !hayMas || typeof IntersectionObserver === "undefined") return;

    const observateur = new IntersectionObserver(
      (entradas) => {
        if (entradas[0]?.isIntersecting) void cargarMasRef.current();
      },
      // Une hauteur d'écran d'avance : la page suivante arrive AVANT que le visiteur atteigne le
      // vide. Sans marge, il verrait le bas de liste puis un saut.
      { rootMargin: "100% 0px" }
    );
    observateur.observe(nodo);
    return () => observateur.disconnect();
  }, [hayMas]);

  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      {/* La grille de tuiles de la charte (plan 41, P2) : 1, 2 puis 3 colonnes, 16 px d'écart puis
          24 à partir de `lg`, dans la colonne de 960 px — c'est ce que suppose `SIZES_GRILLA` de
          `TarjetaOferta`. Classes écrites EN TOUTES LETTRES : Tailwind v4 scanne le texte source,
          une classe fabriquée par interpolation n'est pas générée et la grille retombe en une
          colonne sans que rien ne le signale. */}
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {tarjetas.map((tarjeta, index) => (
          // La clé vient de la donnée, jamais de l'index : une page ajoutée réordonnerait les
          // cartes et React réutiliserait les mauvaises.
          <li key={tarjeta.clave}>
            <TarjetaOferta
              oferta={tarjeta}
              variante="grilla"
              locale={locale}
              // Une seule image prioritaire dans la page, et c'est la première de la liste : le LCP.
              prioridad={index === 0}
            />
          </li>
        ))}
      </ul>

      {/* La sentinelle est purement technique : aucun contenu, aucun rôle, invisible à l'assistance
          — ce qu'elle déclenche est annoncé par la région d'état ci-dessous. */}
      <div ref={sentinela} aria-hidden="true" data-testid={`${testId}-centinela`} />

      {/* ⚠️ RENDUE EN PERMANENCE, VIDE AU REPOS. Un `role="status"` monté au moment où il a quelque
          chose à dire n'est jamais annoncé : la région doit exister AVANT que son contenu change.
          C'est la faute classique du motif, invisible à l'œil comme au typecheck — spec 28
          §10quater, où elle avait déjà été commise puis corrigée.
          Plan 41, P2 : le décompte au rôle `meta` (Poppins 500, 14 px), marine sur l'or ; l'échec
          dans l'encadré d'erreur de la charte (S6), DANS la région, qui reste la même. */}
      <div role="status" aria-live="polite" data-testid={`${testId}-estado`}>
        {fallo && !cargando ? (
          <Aviso tono="error">{t("errorCarga")}</Aviso>
        ) : (
          <p className="text-center text-sm font-medium text-muted">
            {cargando ? t("cargando") : t("conteo", { cargadas: tarjetas.length, total })}
          </p>
        )}
      </div>

      {hayMas ? (
        <div className="flex justify-center">
          {/* ⚠️ `isPending`, JAMAIS `isDisabled` — l'atome `Button` le dit en toutes lettres et la
              raison compte ici plus qu'ailleurs : un bouton désactivé PERD LE FOCUS. Le visiteur
              qui vient de l'activer au clavier serait renvoyé en haut du document à chaque page
              chargée, c'est-à-dire à chaque fois qu'il utilise le seul chemin qui lui est garanti.
              `isPending` neutralise l'action, garde le focus et annonce le changement.
              ⚠️ Et il reste À SA PLACE en cas d'échec, sous l'encadré, au lieu d'entrer dans son
              `accion` : déplacé, React le remonterait, et le focus serait perdu au pire moment.
              `marine` : la page est or, un bouton or y disparaîtrait (F4) ; `lg` : 48 px. */}
          <Button
            color="marine"
            size="lg"
            onPress={() => void cargarMas()}
            isPending={cargando}
            pendingLabel={t("cargando")}
            testId={`${testId}-cargar-mas`}
          >
            {fallo ? t("reintentar") : t("cargarMas")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
