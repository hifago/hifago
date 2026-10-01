import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { simularSesion } from "@/.storybook/support/supabaseFalso";
import NoEncontrado from "./not-found";
import ErrorVitrine from "./(vitrine)/error";
import ErrorTunel from "./(tunnel)/error";
import ErrorCuenta from "./(cuenta)/error";

// Les écrans d'échec, dans la coquille de leur zone. Hors d'un vrai serveur Next, `notFound()` et
// les frontières `error.tsx` ne se déclenchent pas d'elles-mêmes : on rend donc ces écrans
// directement — ce sont eux que voit un visiteur sur une URL inconnue ou une panne de lecture.
const meta = { title: "Écrans/Erreurs et page introuvable", id: "ecrans-erreurs" } satisfies Meta;
export default meta;

const panne = Object.assign(new Error("relation \"public.products\" does not exist"), { digest: "storybook" });
const reintentar = () => {};

export const PaginaNoEncontrada: StoryObj = {
  ...historiaDePagina({ Page: NoEncontrado, grupo: "ninguno", ruta: "/no-existe" }),
  name: "Page introuvable (404)",
};

export const ErrorEnLaVitrina: StoryObj = {
  ...historiaDePagina({
    Page: () => <ErrorVitrine error={panne} retry={reintentar} />,
    grupo: "vitrine",
    ruta: "/actividades",
  }),
  name: "Panne, zone vitrine",
};

export const ErrorEnElTunel: StoryObj = {
  ...historiaDePagina({ Page: () => <ErrorTunel error={panne} retry={reintentar} />, grupo: "tunnel", ruta: "/pago" }),
  name: "Panne, zone tunnel",
};

export const ErrorEnLaCuenta: StoryObj = {
  ...historiaDePagina({
    Page: () => <ErrorCuenta error={panne} retry={reintentar} />,
    grupo: "cuenta",
    ruta: "/cuenta/perfil",
    preparar: () => simularSesion("cuenta"),
  }),
  name: "Panne, zone compte",
};
