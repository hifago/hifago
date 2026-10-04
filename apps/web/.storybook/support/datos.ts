import { mocked } from "storybook/test";
import { getProductoPorSlug } from "@/lib/catalog/producto";
import { getMyProfile, getPartnerAccountProfileFields } from "@/lib/account/getMyProfile";
import { getViewerAccount, viewerIsRealAccount } from "@/lib/auth/viewer";
import { getMyOrders } from "@/lib/orders/getMyOrders";
import { getCartLines, type CartLineForDisplay } from "@/lib/cart/getCartLines";
import { getPendingOrdersForViewer } from "@/lib/orders/getPendingOrdersForViewer";
import { getOrderByToken } from "@/lib/orders/getOrderByToken";
import { buscarCategorias, buscarSecciones, buscarTipo } from "@/lib/catalog/buscar";
import { getEstablecimientoPorSlug } from "@/lib/catalog/establecimiento";
import { ordenarTipos } from "@/lib/catalog/ordenSecciones";
import { ORDEN_SECCIONES, type TarjetaOferta } from "@/lib/catalog/tipos";
import { FICHAS } from "./fixtures/productos";
import { CATEGORIAS_POR_TIPO, ESTABLECIMIENTOS, TARJETAS_POR_TIPO } from "./fixtures/catalogo";
import { MIS_RESERVAS, PERFIL_COMPLETO } from "./fixtures/cuenta";
import { PEDIDOS_POR_TOKEN } from "./fixtures/pedidos";
import { carritoSimulado, esCuentaRealSimulada, usuarioSimulado } from "./supabaseFalso";

/** Recherche texte grossière (`?q=`), sans accents : assez pour qu'une recherche « vide » existe. */
function filtrarPorTexto(tarjetas: TarjetaOferta[], q?: string): TarjetaOferta[] {
  if (!q) return tarjetas;
  const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return tarjetas.filter((t) => normalizar(t.nombre).includes(normalizar(q)));
}

/**
 * Le panier tel que `/mi-viaje` et `/pago` le lisent, DÉRIVÉ du panier en mémoire du faux client
 * Supabase (`simularCarrito`, ou un vrai ajout depuis une fiche) joint aux fiches produit. C'est
 * ce qui garde la pastille de l'en-tête (lue côté navigateur) d'accord avec la page.
 */
export function lineasDelCarritoSimulado(): CartLineForDisplay[] {
  return carritoSimulado().map((fila) => {
    const ficha = FICHAS.find((f) => f.id === fila.product_id);
    return {
      id: fila.id,
      productId: fila.product_id,
      productName: ficha?.nombre ?? fila.product_id,
      productType: ficha?.tipo ?? "",
      productSlug: ficha?.slug ?? "",
      establishmentId: ficha?.establecimiento?.id ?? "",
      establishmentName: ficha?.establecimiento?.nombre ?? "",
      date: fila.date,
      endDate: fila.end_date,
      slotStartTime: fila.slot_start_time?.slice(0, 5) ?? null,
      qty: fila.qty,
      priceCop: ficha?.precio && "cop" in ficha.precio ? ficha.precio.cop : 0,
      unavailable: false,
      durationDays: ficha?.duracionDias ?? null,
      priceTiers: (ficha?.alojamiento?.priceTiers as CartLineForDisplay["priceTiers"]) ?? null,
    };
  });
}

// Réponses PAR DÉFAUT des lectures de `lib/` dans le Storybook (2026-10-01).
//
// Les modules de données sont enregistrés en mode ESPION (`sb.mock(…, { spy: true })`,
// .storybook/preview.tsx) : le vrai module est chargé, ses fonctions pures (`hrefSeccion`,
// `resolverModoReserva`…) gardent leur vraie implémentation, et seules les LECTURES sont
// redirigées ici, vers les fixtures. Réinstallées avant CHAQUE story par le `beforeEach` du preview ;
// une story qui veut un autre état surcharge ensuite dans son propre `beforeEach` :
//   mocked(getProductoPorSlug).mockResolvedValue(null)
//
// ⚠️ Une lecture NON redirigée ici partirait vers la vraie base — qui n'existe pas dans ce
// Storybook. Tout nouveau module de données branché sur une page doit donc arriver ici ET dans
// `preview.tsx`, dans le même geste.
export function instalarDatosPorDefecto() {
  mocked(getProductoPorSlug).mockImplementation(
    async (slug: string) => FICHAS.find((ficha) => ficha.slug === slug) ?? null
  );

  // Identité : dérivée de la session du faux client Supabase (`simularSesion`), pour qu'une page
  // qui la lit côté serveur et un composant qui la lit côté navigateur disent toujours la même chose.
  mocked(viewerIsRealAccount).mockImplementation(async () => esCuentaRealSimulada());
  mocked(getViewerAccount).mockImplementation(async () => {
    const usuario = usuarioSimulado();
    return usuario && !usuario.is_anonymous ? { id: usuario.id, email: usuario.email } : null;
  });
  mocked(getMyProfile).mockImplementation(async () => (esCuentaRealSimulada() ? PERFIL_COMPLETO : null));
  mocked(getPartnerAccountProfileFields).mockImplementation(async () => ({
    fullName: PERFIL_COMPLETO.fullName,
    phone: PERFIL_COMPLETO.phone,
  }));
  mocked(getMyOrders).mockImplementation(async () => MIS_RESERVAS);

  // Vitrine. ⚠️ Le réordonnancement « depuis le panier » vit DANS la vraie `buscarSecciones` : la
  // réponse simulée doit le refaire elle-même, avec le vrai `ordenarTipos`.
  mocked(buscarSecciones).mockImplementation(async (criterios, { porSeccion, tiposEnCarrito }) => {
    const orden = tiposEnCarrito ? ordenarTipos(tiposEnCarrito) : [...ORDEN_SECCIONES];
    return orden
      .filter((tipo) => !criterios.tipo || tipo === criterios.tipo)
      .map((tipo) => {
        const todas = filtrarPorTexto(TARJETAS_POR_TIPO[tipo], criterios.q);
        return { tipo, tarjetas: todas.slice(0, porSeccion), total: todas.length };
      })
      .filter((seccion) => seccion.total > 0);
  });
  // `resolverCategoria` (ListadoTipo.tsx) appelle aussi cette lecture SANS critère pour trouver la
  // catégorie demandée : elle doit donc rendre toutes les catégories non vides.
  mocked(buscarCategorias).mockImplementation(async (tipo, criterios, { porCategoria }) =>
    CATEGORIAS_POR_TIPO[tipo]
      .map((categoria) => {
        const todas = filtrarPorTexto(categoria.tarjetas, criterios.q);
        return { ...categoria, tarjetas: todas.slice(0, porCategoria), total: todas.length };
      })
      .filter((categoria) => categoria.total > 0)
  );
  mocked(buscarTipo).mockImplementation(async (tipo, criterios, { limite, desplazamiento, sinTag }) => {
    const categorias = CATEGORIAS_POR_TIPO[tipo];
    const categoria = sinTag ? categorias.find((c) => c.esSinTag) : categorias.find((c) => c.slug === criterios.tag);
    const todas = filtrarPorTexto(categoria?.tarjetas ?? TARJETAS_POR_TIPO[tipo], criterios.q);
    const tarjetas = todas.slice(desplazamiento, desplazamiento + limite);
    return { tarjetas, total: todas.length, hayMas: desplazamiento + tarjetas.length < todas.length };
  });
  mocked(getEstablecimientoPorSlug).mockImplementation(
    async (slug: string) => ESTABLECIMIENTOS.find((e) => e.slug === slug) ?? null
  );

  // Tunnel de réservation.
  mocked(getCartLines).mockImplementation(async () => lineasDelCarritoSimulado());
  mocked(getPendingOrdersForViewer).mockImplementation(async () => []);
  mocked(getOrderByToken).mockImplementation(async (token: string) => PEDIDOS_POR_TOKEN[token] ?? null);
}
