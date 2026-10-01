import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CartProvider } from "@/lib/cart/CartContext";
import { lineasDelCarritoSimulado } from "@/.storybook/support/datos";
import { simularCarrito } from "@/.storybook/support/supabaseFalso";
import { CARRITO_UN_DIA, CARRITO_VIAJE } from "@/.storybook/support/fixtures/carrito";
import type { Locale } from "@/messages";
import { CartSummary } from "./CartSummary";

// Le récapitulatif du voyage, monté par `/mi-viaje` (éditable) et `/pago` (lecture seule). Les
// lignes viennent du même panier simulé que les stories d'écran (`support/fixtures/carrito.ts`).
// Story manquante relevée le 2026-10-01 : c'était le seul organism sans playground.
const meta = {
  title: "Affichage/CartSummary",
  component: CartSummary,
  // `appDirectory` : « Quitar » appelle `router.refresh()` du routeur App, absent sinon.
  parameters: { layout: "padded", nextjs: { appDirectory: true } },
  decorators: [
    (Story) => (
      <CartProvider>
        <div className="max-w-2xl">
          <Story />
        </div>
      </CartProvider>
    ),
  ],
} satisfies Meta<typeof CartSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

const conLineas = (lineas: typeof CARRITO_VIAJE, editable: boolean): Story => ({
  args: { lines: [], editable, locale: "es" },
  beforeEach: () => simularCarrito(lineas),
  render: (args, { globals }) => (
    <CartSummary {...args} lines={lineasDelCarritoSimulado()} locale={(globals.locale as Locale) ?? "es"} />
  ),
});

export const Editable: Story = { ...conLineas(CARRITO_VIAJE, true) };
export const LecturaSola: Story = { ...conLineas(CARRITO_VIAJE, false) };
export const UnSoloDia: Story = { ...conLineas(CARRITO_UN_DIA, true) };
export const Vacio: Story = { args: { lines: [], editable: true, locale: "es" } };
