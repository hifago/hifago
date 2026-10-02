import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductSlotRulesBlock } from "./ProductSlotRulesBlock";

// Le remplacement des horaires est UNE RPC (replace_product_slot_rules, 20261001235031) : delete et
// inserts dans la même transaction. Ce test garde la frontière côté navigateur — jamais d'écriture
// directe dans product_slot_rules, qui pouvait laisser l'activité sans règle entre deux requêtes.
const appelsRpc: { fn: string; args: unknown }[] = [];
const tablesTouchees: string[] = [];

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    rpc: (fn: string, args: unknown) => {
      appelsRpc.push({ fn, args });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from: (table: string) => {
      tablesTouchees.push(table);
      return {};
    },
  }),
}));

describe("ProductSlotRulesBlock", () => {
  beforeEach(() => {
    appelsRpc.length = 0;
    tablesTouchees.length = 0;
  });

  it("« Guardar horarios » remplace les règles par un seul appel RPC, jamais par product_slot_rules", async () => {
    render(
      <ProductSlotRulesBlock
        productId="prod-1"
        initialRules={[
          { weekdays: [3, 1], startTime: "09:00", endTime: "12:00", slotDurationMinutes: "60", capacity: "8" },
        ]}
      />
    );

    await userEvent.click(screen.getByTestId("save-slot-rules-button"));

    expect(appelsRpc).toEqual([
      {
        fn: "replace_product_slot_rules",
        args: {
          p_product_id: "prod-1",
          p_rules: [
            { weekdays: [1, 3], start_time: "09:00", end_time: "12:00", slot_duration_minutes: 60, capacity: 8 },
          ],
        },
      },
    ]);
    expect(tablesTouchees).not.toContain("product_slot_rules");
  });

  it("vider les horaires passe aussi par la RPC, avec une liste vide", async () => {
    render(<ProductSlotRulesBlock productId="prod-2" initialRules={[]} />);

    await userEvent.click(screen.getByTestId("save-slot-rules-button"));

    expect(appelsRpc).toEqual([
      { fn: "replace_product_slot_rules", args: { p_product_id: "prod-2", p_rules: [] } },
    ]);
    expect(tablesTouchees).toEqual([]);
  });
});
