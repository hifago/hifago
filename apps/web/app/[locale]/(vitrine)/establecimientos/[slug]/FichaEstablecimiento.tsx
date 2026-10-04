"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Title } from "@/components/atoms/Title";
import { GlypheWhatsApp } from "@/components/atoms/GlypheWhatsApp";
import { PuceEstado } from "@/components/atoms/PuceEstado";
import { PhotoStrip } from "@/components/molecules/PhotoStrip";
import { AmenidadesList } from "@/components/molecules/AmenidadesList";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
import { SeccionRiel } from "@/components/organisms/SeccionRiel";
import type { FichaEstablecimiento as DatosFicha } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";
import { urlDeContacto } from "@/lib/catalog/establecimiento";
import { BotonContacto } from "../../productos/[slug]/BotonContacto";

// LE CORPS DE LA FICHE ÉTABLISSEMENT (spec 30 §5d). Ex-`EstablishmentDetailView`.
//
// ⚠️ « use client » pour la même raison que la fiche produit : un Server Component ne peut pas
// importer `@hifago/ui` (CLAUDE.md §11.16) — `PhotoStrip` et `BotonContacto` y mènent. Il ne pose
// PLUS de `<main>` : `PageShell` le fait.
//
// PLAN 41, P4 (2026-10-03) — la page au style de l'accueil :
//   - BANDEAU OR à fond perdu (`BandeauPagina contenido`), qui porte le SEUL `<h1>` (le nom, sans
//     point : un nom propre), l'adresse, les horaires en puces et « Contactar por WhatsApp » en
//     bouton MARINE (un bouton or disparaîtrait sur l'or, F4). Rendu ICI et non par `page.tsx`, comme
//     la fiche produit : les horaires y sont traduits, et le fil d'Ariane arrive déjà rendu par la
//     page, qui en tire aussi le JSON-LD ;
//   - CONTENU CLAIR : galerie et description, côte à côte à partir de `lg` sur la grille de la fiche
//     produit (lecture de 560 px, colonne de 360 px) — la même photo tombe au même endroit d'une
//     fiche à l'autre ; puis « Equipamiento » sur toute la colonne, groupes en trois colonnes ;
//   - LES OFFRES EN RAILS (`SeccionRiel`, S3) : « Habitaciones● », « Actividades y servicios● » —
//     titre à point, motif, conteneur marine, tuiles S4 avec prix et capacité. Sans « GO → » : il n'y
//     a pas de page « tout voir » d'un établissement.
//     ⚠️ Avant (2026-09-08, spec 30 §3.9), des grilles de `TarjetaOferta` de 224 px : « une rangée
//     d'offres est un rail » (D7) a remplacé la grille, comme sur l'index par type (P1).
//     `SeccionRiel` n'a pas de `"use client"` : rendu depuis ce fichier client, il est servi tout de
//     même (SSR), tuiles comprises — c'est leur HTML que Google indexe.
export function FichaEstablecimiento({
  ficha,
  locale,
  migas,
}: {
  ficha: DatosFicha;
  locale: Locale;
  /** Le fil d'Ariane, déjà rendu par la page (qui en tire le JSON-LD). */
  migas?: ReactNode;
}) {
  const t = useTranslations("EstablishmentPage");
  const tCommon = useTranslations("Common");
  // Les libellés des tuiles : ceux de l'accueil et de l'index par type, jamais une seconde clé au
  // même texte (P1).
  const tHome = useTranslations("HomePage");

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
  ].filter((horario): horario is string => Boolean(horario));

  const sinNada = ficha.alojamientos.length === 0 && ficha.otrosProductos.length === 0;

  // Le bandeau, sous le H1 : l'adresse, puis une puce par horaire.
  // ⚠️ LES HORAIRES DU LIEU, jamais ceux d'un produit. `products.check_in_time` existe encore, reste
  // éditable côté admin, et n'est lu par AUCUNE page publique — la règle tranchée le 2026-09-08 (spec
  // 30 §3.4). Chaque moitié est facultative : le groupe disparaît entier plutôt que d'afficher une
  // puce vide. Il garde `establishment-hours`, en `display: contents` pour que ses puces s'alignent
  // dans la rangée du bandeau (lu par `e2e/establishment-page.spec.ts`).
  const meta =
    ficha.direccion || horarios.length > 0 ? (
      <>
        {ficha.direccion ? (
          <p className="basis-full text-sm font-medium" data-testid="establishment-address">
            {ficha.direccion}
          </p>
        ) : null}
        {horarios.length > 0 ? (
          <span className="contents" data-testid="establishment-hours">
            {horarios.map((horario) => (
              <PuceEstado key={horario} tono="neutro" multilinea>
                {horario}
              </PuceEstado>
            ))}
          </span>
        ) : null}
      </>
    ) : undefined;

  // Les libellés des rails, communs aux deux sections.
  const rail = {
    tamanoTitulo: "seccion" as const,
    locale,
    labelDesde: tHome("precioDesde"),
    conteoAlojamientos: (count: number) => tHome("conteoAlojamientos", { count }),
    capacidadPersonas: (count: number) => tHome("capacidadPersonas", { count }),
  };

  return (
    <>
      <BandeauPagina
        variante="contenido"
        migas={migas}
        // Un nom propre : pas de point.
        titulo={ficha.nombre}
        tituloTestId="establishment-name"
        conPunto={false}
        meta={meta}
        accion={
          // Le bouton n'est jamais rendu sans sa source, et rien ne le remplace : un établissement
          // sans contact n'affiche simplement pas de bouton (spec 30 §5d).
          ficha.contacto ? (
            <BotonContacto
              href={urlDeContacto(ficha.contacto)}
              etiqueta={t("contactar")}
              color="marine"
              width="auto"
              iconBefore={<GlypheWhatsApp />}
              testId="establishment-contact-link"
            />
          ) : undefined
        }
        testId="ficha-bandeau"
      />

      {/* `pt-2 sm:pt-4` : le même départ que la fiche produit sous son bandeau. L'écart entre les
          blocs est celui de l'accueil entre deux rubriques (32 → 72 px), mesuré sur la colonne. */}
      <div className="@container pt-2 sm:pt-4">
        <div className="flex flex-col gap-[clamp(2rem,6cqw,4.5rem)]">
          <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start lg:gap-x-10">
            {/* `sizes` : la colonne de lecture (560 px à partir de `lg`), sinon la colonne de la
                page (gouttières de 20 puis 32 px) — même grille que la fiche produit. */}
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
              sizes="(min-width: 1024px) 560px, (min-width: 640px) calc(100vw - 4rem), calc(100vw - 2.5rem)"
              testId="establishment-photos"
            />

            {ficha.descripcion ? (
              <p className="max-w-prose text-base leading-[1.55] lg:text-[17px]">{ficha.descripcion}</p>
            ) : null}
          </div>

          {/* Équipements structurés (migration 20260917110000, décision Jérôme du 2026-09-17) —
              référentiel fermé, résolu dans la locale par la couche de données. Section entière
              absente si `amenidades` est vide. */}
          {ficha.amenidades.length > 0 ? (
            <section className="flex flex-col gap-3" data-testid="establishment-amenities">
              <Title as="h2" size="bloque">
                {tCommon("amenitiesTitle")}
              </Title>
              <AmenidadesList grupos={ficha.amenidades} testId="establishment-amenities-list" />
            </section>
          ) : null}

          {ficha.alojamientos.length > 0 ? (
            <SeccionRiel {...rail} titulo={tituloAlojamientos} tarjetas={ficha.alojamientos} testId="establishment-lodgings" />
          ) : null}

          {ficha.otrosProductos.length > 0 ? (
            <SeccionRiel
              {...rail}
              titulo={t("activitiesTitle")}
              tarjetas={ficha.otrosProductos}
              testId="establishment-activities"
            />
          ) : null}

          {/* ⚠️ ÉTAT INATTEIGNABLE, et il est écrit quand même. `establishments_select_public` exige
              au moins un produit vendable rattaché : un établissement sans aucun produit est
              invisible au public, donc cette page rendrait 404 avant d'arriver ici. Le bloc reste
              parce que la policy peut changer — mais aucun test ne peut l'exercer, et prétendre le
              contraire serait faux (spec 30 §9). */}
          {sinNada ? <EstadoVacio titulo={t("noProducts")} testId="establishment-empty" /> : null}
        </div>
      </div>
    </>
  );
}
