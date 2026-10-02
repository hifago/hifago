import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";

/**
 * Segment d'URL attendu comme UUID (`/admin/products/[id]`…) : la page répond 404 s'il n'en est pas
 * un, avant toute lecture. Sans ce garde, la lecture échouerait (22P02) et la page — qui lève
 * désormais sur une erreur de lecture — afficherait l'écran d'erreur pour une simple faute de
 * frappe dans l'URL.
 */
export function requireUuidParam(value: string): string {
  if (!isUuid(value)) notFound();
  return value;
}
