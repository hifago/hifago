"use client";

import { useTranslations } from "next-intl";
import { Card } from "@hifago/ui";
import { Title } from "@/components/atoms/Title";
import { PhotoStrip } from "@/components/molecules/PhotoStrip";
import { AmenidadesList } from "@/components/molecules/AmenidadesList";
import { TarjetaOferta } from "@/components/molecules/TarjetaOferta";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import type { FichaEstablecimiento as DatosFicha } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";
import { urlDeContacto } from "@/lib/catalog/establecimiento";
import { BotonContacto } from "../../productos/[slug]/BotonContacto";

// LE CORPS DE LA FICHE ÉTABLISSEMENT (spec 30 §5d). Ex-`EstablishmentDetailView`.
//
// ⚠️ « use client » pour la même raison que la fiche produit : un Server Component ne peut pas
// importer `@hifago/ui` (CLAUDE.md §11.16). Il ne pose PLUS de `<main>` — `PageShell` le fait — et
// il porte enfin un `<h1>`.
//
// ⚠️ LES PRODUITS SONT RENDUS EN GRILLE, par `TarjetaOferta` variante `grilla` (décision de Jérôme
// du 2026-09-08, spec 30 §3.9). L'écran d'origine avait sa propre `ProductRow` maison, en
// `Card layout="row"` — donc un visuel de 64 px pour une chambre, dont la photo est justement ce
// qui décide. Conséquence voulue : ce lot NE RÉVEILLE PAS le point ouvert de la spec 28 §10bis sur
// cette variante, qui reste affichée nulle part ailleurs que sur l'accueil.

export function FichaEstablecimiento({
  ficha,
  locale,
}: {
  ficha: DatosFicha;
  locale: Locale;
}) {
  const t = useTranslations("EstablishmentPage");
  const tCommon = useTranslations("Common");

  // Le titre de la section des couchages dépend de la façon dont le lieu se vend. « Sin
  // especificar » n'est pas un oubli à combler : un établissement qui ne vend que des activités
  // n'a pas de mode d'hébergement, et lui en imposer un fabriquerait une information fausse.
  const tituloAlojamientos =
    ficha.modo === "whole_house"
      ? t("wholeHouseTitle")
      : ficha.modo === "rooms"
        ? t("roomsTitle")
        : t("lodgingsTitle");

  const horarios = [
    ficha.horaEntrada ? t("checkIn", { time: ficha.horaEntrada.slice(0, 5) }) : null,
    ficha.horaSalida ? t("checkOut", { time: ficha.horaSalida.slice(0, 5) }) : null,
  ].filter(Boolean);

  const sinNada = ficha.alojamientos.length === 0 && ficha.otrosProductos.length === 0;

  return (
    <>
      <Card>
        <Card.Header>
          <Title as="h1" testId="establishment-name">
            {ficha.nombre}
          </Title>
          {ficha.direccion ? (
            <Card.Description data-testid="establishment-address">{ficha.direccion}</Card.Description>
          ) : null}
        </Card.Header>

        <Card.Content className="flex flex-col gap-6">
          <PhotoStrip
            photos={ficha.fotos.map((foto, index) => ({
              id: `${ficha.slug}-${index}`,
              alt: t("fotoAlt", {
                nombre: ficha.nombre,
                indice: index + 1,
                total: ficha.fotos.length,
              }),
              url: foto.url,
            }))}
            loading="priority"
            sizes="(min-width: 768px) 768px, 100vw"
            testId="establishment-photos"
          />

          {ficha.descripcion ? (
            <p className="text-sm text-muted">{ficha.descripcion}</p>
          ) : null}

          {/* ⚠️ LES HORAIRES DU LIEU, jamais ceux d'un produit. `products.check_in_time` existe
              encore, reste éditable côté admin, et n'est lu par AUCUNE page publique — la règle
              tranchée le 2026-09-08 (spec 30 §3.4). Chaque moitié est facultative : la ligne
              disparaît entière plutôt que d'afficher un séparateur orphelin. */}
          {horarios.length > 0 ? (
            <p className="text-sm text-muted" data-testid="establishment-hours">
              {horarios.join(" · ")}
            </p>
          ) : null}

          {/* Le bouton n'est jamais rendu sans sa source, et rien ne le remplace : un
              établissement sans contact n'affiche simplement pas de bouton (spec 30 §5d). */}
          {ficha.contacto ? (
            <BotonContacto
              href={urlDeContacto(ficha.contacto)}
              etiqueta={t("contactar")}
              testId="establishment-contact-link"
            />
          ) : null}

          {/* Équipements structurés (migration 20260917110000, décision Jérôme du 2026-09-17) —
              référentiel fermé, résolu dans la locale par la couche de données. Section entière
              absente si `amenidades` est vide, même discipline que les horaires juste au-dessus. */}
          {ficha.amenidades.length > 0 ? (
            <section className="flex flex-col gap-3" data-testid="establishment-amenities">
              <Title as="h2" size="bloque">
                {tCommon("amenitiesTitle")}
              </Title>
              <AmenidadesList grupos={ficha.amenidades} testId="establishment-amenities-list" />
            </section>
          ) : null}
        </Card.Content>
      </Card>

      {ficha.alojamientos.length > 0 ? (
        <section className="flex flex-col gap-4" data-testid="establishment-lodgings">
          <Title as="h2">{tituloAlojamientos}</Title>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ficha.alojamientos.map((tarjeta) => (
              <li key={tarjeta.clave}>
                <TarjetaOferta oferta={tarjeta} variante="grilla" locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ficha.otrosProductos.length > 0 ? (
        <section className="flex flex-col gap-4" data-testid="establishment-activities">
          <Title as="h2">{t("activitiesTitle")}</Title>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ficha.otrosProductos.map((tarjeta) => (
              <li key={tarjeta.clave}>
                <TarjetaOferta oferta={tarjeta} variante="grilla" locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ⚠️ ÉTAT INATTEIGNABLE, et il est écrit quand même. `establishments_select_public` exige au
          moins un produit vendable rattaché : un établissement sans aucun produit est invisible au
          public, donc cette page rendrait 404 avant d'arriver ici. Le bloc reste parce que la
          policy peut changer — mais aucun test ne peut l'exercer, et prétendre le contraire serait
          faux (spec 30 §9). */}
      {sinNada ? (
        <EstadoVacio titulo={t("noProducts")} testId="establishment-empty" />
      ) : null}
    </>
  );
}
