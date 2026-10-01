// Faux client Supabase des stories d'écran (2026-10-01) — c'est lui qui permet d'ouvrir le
// Storybook SANS Docker, sans Supabase local et sans `.env.local` : Jérôme le lance chez lui pour
// décider du design, il ne doit avoir rien d'autre à démarrer.
//
// Branché par les alias Vite de `.storybook/main.ts` : `@hifago/supabase/client` et
// `@hifago/supabase/server` pointent vers `support/mocks/supabase-{client,server}.ts`, qui ne font
// que construire ce client.
//
// ⚠️ Ne couvre QUE ce que l'arbre client appelle réellement : `lib/cart/CartContext.tsx`
// (getSession, signInAnonymously, cart_items), `lib/auth/useIsAuthenticated.ts` (getUser,
// onAuthStateChange) et les formulaires d'auth. Toute autre méthode `auth.*` répond « succès
// vide » via le Proxy plus bas — un écran qui en dépendrait vraiment doit l'ajouter ici,
// explicitement, plutôt que de compter sur ce repli.

type Usuario = { id: string; email: string; is_anonymous: boolean };

type FilaCarrito = {
  id: string;
  account_id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  slot_start_time: string | null;
  qty: number;
  created_at: string;
};

export type LineaCarritoFalsa = {
  productId: string;
  date: string;
  endDate?: string;
  slotStartTime?: string;
  qty: number;
};

export type Respuesta = { data: unknown; error: { message: string; code?: string } | null };

// Réponses par défaut des RPC appelées depuis le navigateur — le cas « tout va bien ». Formes
// relevées dans les écrans qui les lisent (ProfileForm, CancelLineButton) le 2026-10-01.
const RPC_POR_DEFECTO: Record<string, Respuesta> = {
  update_my_account_profile: { data: { ok: true }, error: null },
  cancel_order_line: { data: { ok: true, remaining_active_lines: 1 }, error: null },
  // Tunnel : la commande créée s'appelle toujours `o-nueva`, et `orders` (plus bas) sait en rendre
  // le jeton — c'est ce que `CheckoutForm` relit juste après `create_order`.
  create_order: { data: { ok: true, order_id: "o-nueva" }, error: null },
  create_payment_intent: { data: { ok: true, payment_id: "pay-1" }, error: null },
};

type Fila = Record<string, unknown>;

// Contenu des tables autres que `cart_items`, lues par `.from(…)` côté serveur ou navigateur.
const TABLAS_POR_DEFECTO: Record<string, Fila[]> = {
  orders: [{ id: "o-nueva", access_token: "token-o-nueva" }],
};

const estado = {
  usuario: null as Usuario | null,
  carrito: [] as FilaCarrito[],
  /** Erreur renvoyée par toute méthode d'auth (connexion refusée, inscription impossible…). */
  errorAuth: null as string | null,
  /** Noms de méthodes `auth.*` ou de RPC qui ne répondent JAMAIS : l'état « envoi en cours ». */
  pendientes: new Set<string>(),
  rpc: { ...RPC_POR_DEFECTO } as Record<string, Respuesta>,
  tablas: structuredClone(TABLAS_POR_DEFECTO),
  oyentes: new Set<(evento: string, sesion: unknown) => void>(),
};

const USUARIO_ANONIMO: Usuario = { id: "anon-1", email: "", is_anonymous: true };
const USUARIO_CUENTA: Usuario = { id: "cuenta-1", email: "laura@ejemplo.co", is_anonymous: false };

function sesion() {
  return estado.usuario ? { user: estado.usuario, access_token: "falso" } : null;
}

function notificar(evento: string) {
  for (const oyente of estado.oyentes) oyente(evento, sesion());
}

/** Remis à zéro avant chaque story d'écran (`historiaDePagina`) : aucune fuite d'une story à l'autre. */
export function reiniciarSupabaseFalso() {
  estado.usuario = null;
  estado.carrito = [];
  estado.errorAuth = null;
  estado.pendientes = new Set();
  estado.rpc = { ...RPC_POR_DEFECTO };
  estado.tablas = structuredClone(TABLAS_POR_DEFECTO);
}

/** L'identité simulée — lue par les réponses par défaut de `lib/auth/viewer`, `lib/account`… */
export function usuarioSimulado(): Usuario | null {
  return estado.usuario;
}

/** Les lignes de `cart_items` simulées — la même source pour l'en-tête (navigateur) et `/mi-viaje` (serveur). */
export function carritoSimulado(): readonly FilaCarrito[] {
  return estado.carrito;
}

export function esCuentaRealSimulada(): boolean {
  return Boolean(estado.usuario) && !estado.usuario?.is_anonymous;
}

export function simularSesion(tipo: "ninguna" | "anonima" | "cuenta") {
  estado.usuario = tipo === "ninguna" ? null : tipo === "anonima" ? USUARIO_ANONIMO : USUARIO_CUENTA;
}

/** Remplit `cart_items` — et pose une session anonyme s'il n'y en a pas, comme le vrai premier ajout. */
export function simularCarrito(lineas: LineaCarritoFalsa[]) {
  if (!estado.usuario) estado.usuario = USUARIO_ANONIMO;
  estado.carrito = lineas.map((linea, indice) => ({
    id: `linea-${indice + 1}`,
    account_id: estado.usuario!.id,
    product_id: linea.productId,
    date: linea.date,
    end_date: linea.endDate ?? null,
    slot_start_time: linea.slotStartTime ?? null,
    qty: linea.qty,
    created_at: `2026-01-01T00:00:${String(indice).padStart(2, "0")}Z`,
  }));
}

/** Toute méthode `auth.*` échoue — aucun écran ne lit le code ni le message, seul `error` compte. */
export function simularErrorAuth(mensaje: string | null) {
  estado.errorAuth = mensaje;
}

/** Ces méthodes (`"signInWithPassword"`, `"rpc:cancel_order_line"`…) ne répondront jamais. */
export function simularPendiente(...nombres: string[]) {
  for (const nombre of nombres) estado.pendientes.add(nombre);
}

/** Remplace le contenu d'une table (hors `cart_items`, voir `simularCarrito`). */
export function simularTabla(tabla: string, filas: Fila[]) {
  estado.tablas[tabla] = filas;
}

export function simularRpc(nombre: string, respuesta: Respuesta) {
  estado.rpc[nombre] = respuesta;
}

const nunca = () => new Promise<never>(() => {});

// Constructeur de requête minimal : chaînable, et « thenable » comme celui de supabase-js. Filtres
// `eq` seulement ; `maybeSingle`/`single` rendent la première ligne (ou `null`), comme le vrai.
function consulta(tabla: string) {
  let operacion: "select" | "insert" | "delete" = "select";
  let filasAInsertar: Fila[] = [];
  let unico = false;
  const filtros: [string, unknown][] = [];

  const coincide = (fila: Fila) => filtros.every(([col, valor]) => fila[col] === valor);

  const ejecutar = (): Respuesta => {
    if (tabla === "cart_items") {
      if (operacion === "insert") {
        for (const fila of filasAInsertar) {
          estado.carrito.push({
            ...(fila as Omit<FilaCarrito, "id" | "created_at">),
            id: `linea-${estado.carrito.length + 1}`,
            // Horodatage fictif mais ORDONNÉ : seul l'ordre d'insertion compte pour `order("created_at")`.
            created_at: `2026-01-01T00:01:${String(estado.carrito.length).padStart(2, "0")}Z`,
          });
        }
        return { data: null, error: null };
      }
      if (operacion === "delete") {
        estado.carrito = estado.carrito.filter((fila) => !coincide(fila));
        return { data: null, error: null };
      }
    }
    if (operacion !== "select") return { data: null, error: null };
    const filas = (tabla === "cart_items" ? (estado.carrito as Fila[]) : (estado.tablas[tabla] ?? [])).filter(coincide);
    return { data: unico ? (filas[0] ?? null) : filas, error: null };
  };

  const constructor = {
    select: () => constructor,
    order: () => constructor,
    limit: () => constructor,
    eq: (col: string, valor: unknown) => {
      filtros.push([col, valor]);
      return constructor;
    },
    insert: (filas: Fila | Fila[]) => {
      operacion = "insert";
      filasAInsertar = Array.isArray(filas) ? filas : [filas];
      return constructor;
    },
    delete: () => {
      operacion = "delete";
      return constructor;
    },
    single: () => {
      unico = true;
      return constructor;
    },
    maybeSingle: () => {
      unico = true;
      return constructor;
    },
    then: <T>(resolver: (respuesta: Respuesta) => T) => Promise.resolve(ejecutar()).then(resolver),
  };
  return constructor;
}

const auth = {
  getSession: async () => ({ data: { session: sesion() }, error: null }),
  getUser: async () => ({ data: { user: estado.usuario }, error: null }),
  onAuthStateChange: (oyente: (evento: string, sesion: unknown) => void) => {
    estado.oyentes.add(oyente);
    return { data: { subscription: { unsubscribe: () => estado.oyentes.delete(oyente) } } };
  },
  signInAnonymously: async () => {
    // Échec possible : c'est l'« ajout au panier impossible » (toast d'erreur), le seul chemin par
    // lequel `CartContext.addLine` refuse une ligne.
    if (estado.errorAuth) return { data: { session: null, user: null }, error: { message: estado.errorAuth } };
    estado.usuario = USUARIO_ANONIMO;
    notificar("SIGNED_IN");
    return { data: { session: sesion(), user: estado.usuario }, error: null };
  },
  signInWithPassword: async () => {
    if (estado.errorAuth) return { data: { session: null, user: null }, error: { message: estado.errorAuth } };
    estado.usuario = USUARIO_CUENTA;
    notificar("SIGNED_IN");
    return { data: { session: sesion(), user: estado.usuario }, error: null };
  },
  signOut: async () => {
    estado.usuario = null;
    notificar("SIGNED_OUT");
    return { error: null };
  },
};

// Toute autre méthode d'auth (signUp, resetPasswordForEmail, updateUser, resend, signInWithOAuth…)
// répond l'erreur simulée s'il y en a une, sinon un succès. ⚠️ `signUp` sans session existante rend
// `session: null` : c'est le parcours « vérifie ton e-mail », celui de la production.
// Une méthode déclarée par `simularPendiente` ne répond jamais, qu'elle soit explicite ou non.
const authConProxy = new Proxy(auth as Record<string, unknown>, {
  get(objetivo, nombre: string) {
    if (estado.pendientes.has(nombre)) return nunca;
    if (nombre in objetivo) return objetivo[nombre];
    return async () =>
      estado.errorAuth
        ? { data: {}, error: { message: estado.errorAuth } }
        : { data: { user: estado.usuario, session: sesion() }, error: null };
  },
});

export function crearClienteFalso() {
  return {
    auth: authConProxy,
    from: (tabla: string) => consulta(tabla),
    rpc: (nombre: string) =>
      estado.pendientes.has(`rpc:${nombre}`)
        ? nunca()
        : Promise.resolve(estado.rpc[nombre] ?? { data: null, error: null }),
  };
}
