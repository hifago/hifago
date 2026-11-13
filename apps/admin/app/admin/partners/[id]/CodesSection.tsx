"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { REF_CODE_MAX_LENGTH } from "@hifago/domain";
import {
  Button,
  Input,
  Label,
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
  Switch,
  toast,
} from "@hifago/ui";

type Code = { code: string; active: boolean };

// Motifs de refus d'add_partner_code (20261112180000) → message affiché.
const ADD_CODE_ERRORS: Record<string, string> = {
  code_required: "Escribe un código.",
  code_too_long: `El código no puede tener más de ${REF_CODE_MAX_LENGTH} caracteres.`,
  code_taken: "Ese código ya existe.",
  partner_not_found: "Este partner ya no existe.",
};

export function CodesSection({ partnerId, codes }: { partnerId: string; codes: Code[] }) {
  const router = useRouter();
  const [updating, setUpdating] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  async function handleToggle(code: string, nextActive: boolean) {
    setUpdating(code);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_partner_code_active", {
      p_code: code,
      p_active: nextActive,
    });

    setUpdating(null);
    if (rpcError) {
      toast.danger("No se pudo cambiar el estado del código.");
      return;
    }
    toast.success(nextActive ? "Código activado." : "Código desactivado.");
    router.refresh();
  }

  // Un code de plus pour CE partenaire (un QR par hôtel d'un même groupe) : rattaché au même
  // partenaire, il garde l'auto-référence sur tous ses établissements.
  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const code = newCode.trim();
    // Même borne que la création de partenaire et que la vitrine : refus explicite, jamais une
    // troncature.
    if (!code) {
      toast.danger(ADD_CODE_ERRORS.code_required);
      return;
    }
    if (code.length > REF_CODE_MAX_LENGTH) {
      toast.danger(ADD_CODE_ERRORS.code_too_long);
      return;
    }

    setIsAdding(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("add_partner_code", {
      p_partner_id: partnerId,
      p_code: code,
    });
    setIsAdding(false);

    const result = data as { ok?: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        (result?.reason && ADD_CODE_ERRORS[result.reason]) || "No se pudo añadir el código.",
      );
      return;
    }
    toast.success("Código añadido.");
    setNewCode("");
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Códigos de atribución</h2>

      <SimpleTable aria-label="Códigos de atribución">
        <SimpleTableHeader>
          <SimpleTableRow>
            <SimpleTableHead>Código</SimpleTableHead>
            <SimpleTableHead>Activo</SimpleTableHead>
          </SimpleTableRow>
        </SimpleTableHeader>
        <SimpleTableBody>
          {codes.length > 0 ? (
            codes.map((code) => (
              <SimpleTableRow key={code.code} id={code.code} data-testid={`code-row-${code.code}`}>
                <SimpleTableCell data-label="Código">{code.code}</SimpleTableCell>
                <SimpleTableCell data-label="Activo">
                  <Switch
                    isSelected={code.active}
                    isDisabled={updating === code.code}
                    onChange={(isActive) => handleToggle(code.code, isActive)}
                    aria-label={`Código ${code.code} activo`}
                    data-testid={`code-active-switch-${code.code}`}
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch.Content>
                  </Switch>
                </SimpleTableCell>
              </SimpleTableRow>
            ))
          ) : (
            <SimpleTableRow>
              <SimpleTableCell colSpan={2} className="text-center text-muted">
                Ningún código todavía.
              </SimpleTableCell>
            </SimpleTableRow>
          )}
        </SimpleTableBody>
      </SimpleTable>

      <form onSubmit={handleAdd} noValidate className="flex flex-wrap items-end gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <Label htmlFor="new-partner-code">Nuevo código</Label>
          <Input
            id="new-partner-code"
            value={newCode}
            onChange={(event) => setNewCode(event.target.value)}
            data-testid="new-code-input"
          />
        </div>
        <Button type="submit" isDisabled={isAdding} data-testid="add-code-button">
          {isAdding ? "Añadiendo…" : "Añadir código"}
        </Button>
      </form>
      <p className="text-sm text-muted">
        Un código por hotel o punto de venta: todos los códigos de este partner cuentan como suyos,
        así que una reserva en sus propios establecimientos sigue siendo auto-recomendación.
      </p>
    </section>
  );
}
