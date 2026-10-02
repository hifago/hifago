"use client";

import { useEffect, useState } from "react";
import { createClient } from "@hifago/supabase/client";
import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
  toast,
  useOverlayState,
} from "@hifago/ui";
import { loadSlotOptions, type SlotOption } from "@/lib/agenda/slotOptions";
import { rpcErrorMessage } from "@/lib/errors/rpcErrorMessage";

export type ProductOption = {
  id: string;
  name: string;
  hasSlots: boolean;
};

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Spec 20 §0/§4 — ouverte depuis PartnerAgenda au clic sur une case vide (onAddEvent de
// @svar-ui/react-calendar). Appelle create_manual_order_line (migration 20260818190000) — jamais
// create_order (attribue au compte appelant, inadapté à un walk-in saisi par l'operator au nom
// d'un client). Si le produit choisi porte des créneaux horaires, un vrai horaire est sélectionné
// via get_product_slots (spec 18) — jamais une heure devinée depuis le pixel cliqué.
export function AddReservationDialog({
  initialDate,
  productOptions,
  open,
  onOpenChange,
  onSuccess,
}: {
  initialDate: Date;
  productOptions: ProductOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [date, setDate] = useState(toDateInputValue(initialDate));
  const [productId, setProductId] = useState<string | null>(null);
  const [slotStartTime, setSlotStartTime] = useState<string | null>(null);
  const [slotOptions, setSlotOptions] = useState<SlotOption[]>([]);
  // Lecture des créneaux en échec : dit à l'opérateur, au lieu d'un sélecteur vide qu'il lirait
  // « aucun créneau ce jour-là » (même discipline que components/lobby-option-picker.tsx).
  const [slotsUnavailable, setSlotsUnavailable] = useState(false);
  const [holderName, setHolderName] = useState("");
  const [qty, setQty] = useState("1");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedProduct = productOptions.find((p) => p.id === productId) ?? null;

  function reset() {
    setDate(toDateInputValue(initialDate));
    setProductId(null);
    setSlotStartTime(null);
    setSlotOptions([]);
    setSlotsUnavailable(false);
    setHolderName("");
    setQty("1");
  }

  const state = useOverlayState({
    isOpen: open,
    onOpenChange: (next) => {
      if (!next) reset();
      onOpenChange(next);
    },
  });

  const shouldFetchSlots = Boolean(selectedProduct?.hasSlots && productId);

  useEffect(() => {
    // slotOptions n'est rendu que si selectedProduct?.hasSlots (cf. JSX plus bas) — une valeur
    // périmée laissée en état pendant qu'aucun produit à créneaux n'est sélectionné est donc
    // invisible, jamais besoin de la vider synchroniquement ici (évite un setState synchrone en
    // tête d'effet, cf. règle react-hooks/set-state-in-effect).
    if (!shouldFetchSlots || !productId) {
      return;
    }
    let cancelled = false;
    loadSlotOptions(createClient(), productId, date).then((result) => {
      if (cancelled) return;
      setSlotsUnavailable(!result.ok);
      setSlotOptions(result.ok ? result.options : []);
    });
    return () => {
      cancelled = true;
    };
  }, [shouldFetchSlots, productId, date]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!productId) {
      toast.danger("Selecciona una actividad.");
      return;
    }
    if (selectedProduct?.hasSlots && !slotStartTime) {
      toast.danger("Selecciona un horario.");
      return;
    }
    if (holderName.trim() === "") {
      toast.danger("El nombre del cliente es obligatorio.");
      return;
    }
    const qtyNumber = Number(qty);
    if (!Number.isInteger(qtyNumber) || qtyNumber < 1) {
      toast.danger("La cantidad debe ser un número entero mayor a 0.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_manual_order_line", {
      p_product_id: productId,
      p_date: date,
      p_qty: qtyNumber,
      p_holder_name: holderName.trim(),
      p_slot_start_time: slotStartTime ?? undefined,
      p_note: "Reserva manual desde la agenda",
    });
    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(describeFailure(rpcError, result?.reason));
      return;
    }

    toast.success("Reserva creada.");
    onSuccess();
  }

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Nueva reserva manual</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate>
              <Modal.Body className="flex flex-col gap-4">
                <TextField
                  value={date}
                  onChange={(value) => {
                    setDate(value);
                    setSlotStartTime(null);
                  }}
                  isRequired
                >
                  <Label htmlFor="manual-date">Fecha</Label>
                  <Input id="manual-date" type="date" data-testid="manual-date-input" />
                </TextField>

                <Select
                  fullWidth
                  placeholder="Selecciona una actividad"
                  value={productId ?? undefined}
                  onChange={(value) => {
                    setProductId((value as string) ?? null);
                    setSlotStartTime(null);
                  }}
                >
                  <Label>Actividad</Label>
                  <Select.Trigger data-testid="manual-product-select">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {productOptions.map((product) => (
                        <ListBox.Item key={product.id} id={product.id} textValue={product.name}>
                          {product.name}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>

                {selectedProduct?.hasSlots ? (
                  <Select
                    fullWidth
                    placeholder="Selecciona un horario"
                    value={slotStartTime ?? undefined}
                    onChange={(value) => setSlotStartTime((value as string) ?? null)}
                  >
                    <Label>Horario</Label>
                    <Select.Trigger data-testid="manual-slot-select">
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {slotOptions.map((slot) => (
                          <ListBox.Item key={slot.slotStartTime} id={slot.slotStartTime} textValue={slot.label}>
                            {slot.label}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                ) : null}
                {selectedProduct?.hasSlots && slotsUnavailable ? (
                  <p role="alert" className="text-sm text-danger" data-testid="manual-slot-error">
                    No se pudieron cargar los horarios. Vuelve a intentarlo.
                  </p>
                ) : null}

                <TextField value={holderName} onChange={setHolderName} isRequired>
                  <Label htmlFor="manual-holder-name">Nombre del cliente</Label>
                  <Input id="manual-holder-name" data-testid="manual-holder-name-input" />
                </TextField>

                <TextField value={qty} onChange={setQty} isRequired>
                  <Label htmlFor="manual-qty">Cantidad de personas</Label>
                  <Input id="manual-qty" type="number" min={1} data-testid="manual-qty-input" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button type="submit" isDisabled={isSubmitting} data-testid="confirm-manual-reservation-button">
                  {isSubmitting ? "Guardando…" : "Crear reserva"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

const FAILURE_MESSAGES: Record<string, string> = {
  not_authenticated: "Tu sesión expiró — vuelve a iniciar sesión.",
  invalid_qty: "La cantidad debe ser un número entero mayor a 0.",
  holder_name_required: "El nombre del cliente es obligatorio.",
  product_not_found: "No se encontró la actividad seleccionada.",
  unsupported_product_type: "Este tipo de producto no admite reservas manuales aquí.",
  not_sellable: "Esta actividad no está disponible para la venta.",
  qty_below_minimum: "La cantidad es menor al mínimo permitido.",
  qty_cap_exceeded: "La cantidad supera el máximo permitido.",
  no_matching_tier: "Ningún tramo de precio cubre esa cantidad.",
  slot_required: "Selecciona un horario.",
  slot_not_found: "El horario seleccionado ya no está disponible.",
  date_closed: "Esta fecha está cerrada.",
  full: "No hay cupo disponible.",
  price_missing: "Esta actividad no tiene un precio configurado.",
};

// Un `reason` connu a son texte ; sinon, jamais le message brut de la RPC
// (lib/errors/rpcErrorMessage.ts).
function describeFailure(
  rpcError: Parameters<typeof rpcErrorMessage>[0],
  reason: string | undefined
): string {
  if (reason && FAILURE_MESSAGES[reason]) {
    return FAILURE_MESSAGES[reason];
  }
  return rpcErrorMessage(rpcError, "No se pudo crear la reserva.");
}
