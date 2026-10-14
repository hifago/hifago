import { payoutAccountSuffix } from "@/lib/payout/payoutAccountSuffix";

// Profil commercial d'un socio (partner_crm_profile), tel que l'écrit create_partner_direct depuis
// « Nuevo socio » — partagé entre le formulaire (client) et la fiche (serveur).

export type CommercialStatus = "prospecto" | "activo" | "inactivo" | "pausa";

export const COMMERCIAL_STATUS_LABELS: Record<CommercialStatus, string> = {
  prospecto: "Prospecto",
  activo: "Activo",
  inactivo: "Inactivo",
  pausa: "En pausa",
};

export function commercialStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return COMMERCIAL_STATUS_LABELS[status as CommercialStatus] ?? status;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };

const texte = (valeur: Json | undefined): string =>
  typeof valeur === "string" ? valeur.trim() : "";

/**
 * Résumé lisible du moyen de paiement (`bank` : `{ nombre, bancolombia?: { numero_cuenta,
 * tipo_cuenta }, nequi?: { telefono } }`), ou `null` sans moyen enregistré. Le numéro n'est jamais
 * rendu en entier (payoutAccountSuffix : décision du cahier socio du 2026-08-11) — calculé côté
 * serveur, seul le suffixe part au navigateur.
 */
export function resumenMetodoPago(bank: Json | null | undefined): string | null {
  if (!bank || typeof bank !== "object" || Array.isArray(bank)) return null;
  const partes: string[] = [];

  const bancolombia = bank.bancolombia;
  const nequi = bank.nequi;
  if (bancolombia && typeof bancolombia === "object" && !Array.isArray(bancolombia)) {
    const tipo = texte(bancolombia.tipo_cuenta);
    partes.push(tipo ? `Bancolombia (${tipo})` : "Bancolombia");
    const sufijo = payoutAccountSuffix(texte(bancolombia.numero_cuenta));
    if (sufijo) partes.push(`cuenta …${sufijo}`);
  } else if (nequi && typeof nequi === "object" && !Array.isArray(nequi)) {
    partes.push("Nequi");
    const sufijo = payoutAccountSuffix(texte(nequi.telefono));
    if (sufijo) partes.push(`teléfono …${sufijo}`);
  }

  const titular = texte(bank.nombre);
  if (titular) partes.push(`titular ${titular}`);
  return partes.length > 0 ? partes.join(" · ") : null;
}
