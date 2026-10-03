"use client";

import { useRef } from "react";
import { ComboBox, InputGroup, ListBox, Spinner } from "@hifago/ui";
import { Button } from "@/components/atoms/Button";
import { sousId } from "@/components/atoms/Field";
import { IconButton } from "@/components/atoms/IconButton";

// LA barre de recherche de la vitrine (2026-09-02, vague 7). Le composant le plus visible du site :
// il vit dans le premier bloc sous le header, sur l'accueil (décision de Jérôme) — donc PAS dans le
// header et PAS collant au défilement. Il n'a aucune contrainte de hauteur imposée par une barre de
// navigation, d'où sa taille : c'est la demande « plus grand que les autres, unique dans la forme ».
//
// `"use client"` obligatoire : ce fichier importe le barrel `@hifago/ui` (CLAUDE.md §11.16).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. LE POINT DUR — deux actions dans un seul champ
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Un champ à suggestions et un champ de recherche sont deux modèles d'interaction différents, et
// `Entrée` appartient aux deux. Les confondre produit le bug classique du motif : on tape « kayak »,
// on appuie sur `Entrée` en pensant chercher « kayak », et on atterrit sur une autre fiche.
//
// ⚠️ Ce n'est pas une hypothèse : getyourguide.com — la référence de facture de ce lot — a
// exactement ce défaut, mesuré au navigateur le 2026-09-02. `Entrée` seul y part sur une SUGGESTION
// (« Dubrovnik ») et jamais sur le texte tapé ; seul le bouton « Buscar » cherche le texte. Combiné
// à la décision « pas de bouton sur mobile » (§4 ci-dessous), ce modèle donnerait un site où l'on ne
// peut JAMAIS chercher en texte libre depuis un téléphone.
//
// LA RÈGLE TENUE ICI, qui n'est le défaut d'aucune bibliothèque :
//   • `Entrée` soumet TOUJOURS le texte tapé, comme le bouton ;
//   • SAUF si l'utilisateur est descendu sur une suggestion avec les flèches — `Entrée` l'active ;
//   • un clic sur une suggestion l'active toujours ;
//   • à l'ouverture, AUCUNE suggestion n'est présélectionnée. C'est cette absence qui rend le reste
//     sûr : sans elle, « Entrée soumet le texte » et « Entrée valide la surbrillance » se disputent.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. LA PRIMITIVE — `ComboBox`, et pourquoi pas les autres (mesuré, pas supposé)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Les quatre candidates de HeroUI ont été montées et exercées dans un vrai navigateur :
//
//   • `Autocomplete` — ÉCARTÉ, et il ne s'agit pas d'un jugement : il ne rend AUCUN `<input>` en
//     façade (mesuré : zéro `input` dans le DOM au repos). Il est bâti sur `Select`, c'est un bouton
//     déclencheur dont le champ de filtre vit DANS le popover. On ne peut pas y taper du texte
//     libre. Même constat que `apps/admin/components/searchable-combobox.tsx` en son temps.
//   • `SearchField` — ÉCARTÉ malgré son `onSubmit` (mesuré : `Entrée` → `onSubmit("kayak")`, ce qui
//     est exactement la règle voulue). Deux raisons : il n'apporte aucun dropdown, donc TOUTE la
//     sémantique ARIA du motif (`role=combobox`, `aria-expanded`, `aria-controls`,
//     `aria-activedescendant`, la navigation clavier) serait à écrire à la main ; et il rend
//     `type="search"`, dont ⚠️ le comportement NATIF de Chromium EFFACE le champ à `Échap` (mesuré :
//     valeur `""` après `Échap`) — l'inverse exact de la règle « `Échap` ferme sans perdre le
//     texte ».
//   • `InputGroup` — non retenu comme SOCLE (il n'apporte ni liste ni clavier), mais employé comme
//     groupe visuel À L'INTÉRIEUR du `ComboBox` : c'est un `Group` react-aria, donc le popover s'y
//     ancre, et il porte le segment texte À L'INTÉRIEUR de la pilule, qui est le `<div>` englobant.
//     ⚠️ Et surtout PAS `ComboBox.InputGroup`, qui est une COLLECTION HeroUI : elle injecte des
//     props de slot dans son DERNIER enfant, donc y glisser un `<div>` ordinaire lui fait recevoir
//     un attribut `$$heroui.collection…` et fait disparaître le champ. Constaté au rendu, la story
//     s'affichait sans son `<input>`.
//   • `ComboBox` — RETENU. Mesuré, il donne gratuitement les trois quarts de la règle :
//       – après la frappe, `aria-activedescendant` vaut `null` et aucune option n'est focalisée :
//         AUCUNE PRÉSÉLECTION, contrairement à la référence ;
//       – `FlècheBas` puis `Entrée` → l'option est activée, et `aria-activedescendant` pointe
//         réellement dessus. ⚠️ C'est précisément ce que la référence rate : chez elle l'attribut
//         reste `null` même après navigation aux flèches, donc un lecteur d'écran n'annonce jamais
//         l'option active. react-aria le fait correctement ;
//       – `Échap` ferme la liste, CONSERVE le texte tapé et garde le focus dans le champ (mesuré :
//         valeur « kayak », `aria-expanded="false"`, focus sur l'input) — à condition de laisser son
//         `type="text"`, cf. le piège `type="search"` ci-dessus. C'est aussi la forme exacte de la
//         référence (`type="text"` + `role="combobox"`).
//
// ⚠️ DEUXIÈME PIÈGE, invisible à l'œil et trouvé à la mesure : react-aria fournit un
// `ButtonContext` à TOUT le sous-arbre du `ComboBox`. Un bouton placé dedans devient donc SON
// déclencheur — mesuré, mon bouton « Buscar » se rendait avec `aria-label="Show suggestions"`,
// `aria-haspopup="listbox"` et `tabindex="-1"` : il n'était plus dans l'ordre de tabulation, il
// s'annonçait sous un autre nom, et il ouvrait la liste au lieu de chercher. D'où la structure
// ci-dessous : la pilule est un conteneur ORDINAIRE, le `ComboBox` en occupe le segment texte, et
// le bouton lui est FRÈRE — hors de portée du contexte.
//
// ⚠️ Le quart manquant, et c'est tout ce que ce fichier ajoute : `Entrée` SEUL ne fait RIEN dans un
// `ComboBox` (mesuré — ni `onSelectionChange`, ni la soumission du `<form>` englobant : react-aria
// avale la touche). Sans correctif, la recherche en texte libre serait impossible. D'où
// `gererEntree` plus bas, six lignes qui lisent l'attribut que le composant publie lui-même.
// ⚠️ PAS de région vivante « N suggestions » dans ce fichier, et c'est un RETRAIT après mesure.
// react-aria en publie déjà une (`role="log" aria-live="assertive"`, contenu « 4 options
// available. »), localisée depuis la langue du document. La mienne était donc un doublon — et un
// doublon CASSÉ : mesurée `aria-hidden="true"` dès que le popover s'ouvre, parce que react-aria
// masque tout ce qui l'entoure (`ariaHideOutside`). Elle se taisait donc exactement quand elle
// aurait servi, pendant que celle de la bibliothèque, elle, parlait.
export type SearchSuggestion = {
  id: string;
  /** Le libellé principal, déjà traduit. */
  label: string;
  /**
   * La ligne secondaire : ce que c'est, et où. « Actividad en Guatapé », « 26 actividades ».
   * ⚠️ C'est ELLE qui porte la nature d'une suggestion — pas un champ typé.
   */
  meta?: string;
  /**
   * ⚠️ Rend la suggestion comme un VRAI `<a href>` (vérifié au rendu : `<a role="option" href>`),
   * donc clic milieu, « ouvrir dans un nouvel onglet » et « copier l'adresse » fonctionnent. Sans
   * lui, l'activation passe uniquement par `onSuggestionSelect`.
   */
  href?: string;
  /**
   * Nature, OPAQUE au composant : jamais lue, jamais interprétée, seulement recopiée en
   * `data-kind`. ⚠️ Volontairement une chaîne libre et pas une union : produits, catégories et
   * établissements sont attendus aujourd'hui, une quatrième nature ne doit pas toucher ce fichier.
   */
  kind?: string;
};

export type SearchBarProps = {
  /** Le texte du champ. Contrôlé par l'appelant — c'est lui qui en dérive les suggestions. */
  value: string;
  onValueChange: (value: string) => void;
  /**
   * ⚠️ Déjà constituées. Ce composant ne cherche RIEN et ne sait pas d'où elles viennent : c'est ce
   * qui le garde intact le jour où une recherche serveur remplacera le filtrage client.
   */
  suggestions: SearchSuggestion[];
  /** Soumission : `Entrée` sans suggestion active, ou le bouton. Reçoit le TEXTE TAPÉ. */
  onSubmit: (query: string) => void;
  /** Une suggestion a été activée : clic, ou `Entrée` après les flèches. */
  onSuggestionSelect: (suggestion: SearchSuggestion) => void;
  /** Nom accessible du champ, déjà traduit — il n'y a pas de `<label>` visible sur une pilule. */
  label: string;
  placeholder: string;
  /** Libellé du bouton de soumission, déjà traduit. */
  submitLabel: string;
  /** Une recherche est en cours : loupe → `Spinner`, bouton "Buscar" → `isPending`. */
  isPending?: boolean;
  /** Libellé du bouton pendant `isPending`, déjà traduit. Sans lui, `submitLabel` est conservé. */
  pendingLabel?: string;
  /** Ce qu'affiche la liste quand elle est vide, déjà traduit. */
  emptyLabel: string;
  /**
   * Nom du bouton « × » qui vide le champ, déjà traduit (maquette de l'accueil, 2026-10-01).
   * Absent = pas de bouton. ⚠️ Il n'apparaît que lorsqu'il y a du TEXTE à effacer : la maquette le
   * dessine dans un champ vide, mais une croix qui n'efface rien serait un bouton sans effet.
   */
  clearLabel?: string;
  /** Texte d'aide sous la barre, déjà traduit. Même vocabulaire que l'atome `Field`. */
  hint?: string;
  /** Message d'erreur, déjà traduit. Même vocabulaire que `Field` — rend la barre invalide. */
  error?: string;
  testId?: string;
};

// La croix du bouton qui vide le champ — même tracé que celle du menu du header.
function CroixIcone() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="size-5 shrink-0"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function LoupeIcone() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="size-5 shrink-0"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function SearchBar({
  value,
  onValueChange,
  suggestions,
  onSubmit,
  onSuggestionSelect,
  label,
  placeholder,
  submitLabel,
  isPending = false,
  pendingLabel,
  emptyLabel,
  clearLabel,
  hint,
  error,
  testId,
}: SearchBarProps) {
  // ⚠️ LES SIX LIGNES QUI TIENNENT LA RÈGLE DU §1. `aria-activedescendant` est publié par le
  // ComboBox lui-même et vaut exactement « l'utilisateur est descendu sur une option » : `null`
  // tant qu'il n'a pas pris les flèches, l'id de l'option ensuite. On lit donc l'état que le
  // composant expose déjà, plutôt que d'en tenir un second en parallèle, qui divergerait.
  // Pour rendre le focus au CHAMP après un effacement : le bouton « × » disparaît avec le texte, et
  // le focus tomberait sinon sur <body> — la tabulation repartirait du début de la page. Une ref sur
  // la pilule plutôt que sur l'`<input>` : celui-ci est rendu par HeroUI, la pilule par ce fichier.
  const pilule = useRef<HTMLDivElement>(null);

  function gererEntree(evenement: React.KeyboardEvent<HTMLInputElement>) {
    if (evenement.key !== "Enter") return;
    const champ = evenement.currentTarget;
    // Une option est active : react-aria l'active, on ne fait rien. (Mesuré : son
    // `onSelectionChange` se déclenche AVANT ce gestionnaire — donc ne jamais soumettre ici.)
    if (champ.getAttribute("aria-activedescendant")) return;
    // Aucune option active : `Entrée` vaut « Rechercher ». `preventDefault` parce que ce champ
    // pourra un jour vivre dans un <form>, et qu'une soumission native le rechargerait.
    evenement.preventDefault();
    onSubmit(champ.value);
  }

  return (
    <div className="flex w-full flex-col gap-2" data-testid={testId}>
      {/* LA PILULE. ⚠️ Sa structure est une RANGÉE de segments, pas un champ décoré : la référence
          en aligne trois (texte, date, participants) et Jérôme n'a demandé que le texte. Ajouter un
          segment un jour = ajouter un frère ici, entre le ComboBox et le bouton, sans toucher au
          reste. C'est aussi ce qui met le bouton HORS du ComboBox (voir le deuxième piège en tête
          de fichier). */}
      {/* ⚠️ LA PILULE DE LA MAQUETTE DE L'ACCUEIL (Jérôme, 2026-10-01) : un aplat BLEU POUDRE de la
          charte (`--default`), sans bordure ni ombre, marine dessus (8.02:1), 44 px de haut — la
          cible tactile minimale ; plus fine, comme sur la maquette, elle ne se viserait plus au pouce.
          Elle remplace la grande pilule blanche bordée de 64 px du 2026-09-02 (« plus grand que les
          autres ») : c'est la maquette qui fait foi désormais. Sans bordure, c'est le contraste de
          l'aplat sur l'or qui la détache de la page — et c'est un champ que l'on repère à sa forme,
          à sa loupe et à son texte, pas à un filet. */}
      {/* ⚠️ Les deux classes qui accompagnent `status-focused` ne sont pas décoratives : sans elles
          le focus dessine TROIS lignes concentriques (relevé par Jérôme, puis mesuré au
          `box-shadow` calculé) — la bordure teal du repos à 1 px, puis 2 px de fond, puis l'anneau
          orange. Le décalage vient de `--ring-offset-width` (2 px), que l'utilitaire `focus-ring`
          de HeroUI réintroduit délibérément par-dessus `ring-offset-0`.
          `ring-offset-0` supprime l'écart, `border-transparent` efface la bordure du repos : il ne
          reste que l'anneau, exactement à la place de la bordure qu'il REMPLACE. Ni l'un ni l'autre
          ne déplace quoi que ce soit — un anneau ne participe pas à la mise en page. */}
      <div
        ref={pilule}
        className="flex min-h-11 w-full items-center gap-1 rounded-full bg-[var(--default)] px-2 text-[var(--default-foreground)] has-[input:focus-visible]:status-focused has-[input:focus-visible]:ring-offset-0"
      >
        <ComboBox
          className="min-w-0 flex-1"
          // ⚠️ Le nom accessible se pose sur la RACINE, pas sur le `<input>` : react-aria le
          // redescend lui-même sur le champ, et sans lui il avertit en développement (« you must
          // specify an aria-label »). Il n'y a pas de `<label>` visible sur une pilule.
          aria-label={label}
          // ⚠️ `items` posé ICI, sur le ComboBox lui-même, et pas seulement sur la ListBox : sans
          // lui react-aria considère la collection comme NON contrôlée et REFILTRE la liste sur le
          // texte tapé. Mesuré : quatre suggestions fournies, une seule affichée après « kayak » —
          // la catégorie « Actividades acuáticas », pertinente pour ce mot, disparaissait. Ça
          // contredisait frontalement le contrat du composant (« il ne cherche rien, il reçoit »),
          // en silence, et ça aurait cassé la moitié de l'intérêt des suggestions hétérogènes.
          items={suggestions}
          // `selectedKey={null}` CONTRÔLÉ, et ce n'est pas cosmétique : sans ça, réactiver la même
          // suggestion deux fois de suite n'est pas un changement de sélection, donc
          // `onSelectionChange` ne se redéclenche pas et le second clic ne fait rien.
          selectedKey={null}
          onSelectionChange={(cle) => {
            if (cle === null) return;
            const choisie = suggestions.find((s) => s.id === String(cle));
            if (choisie) onSuggestionSelect(choisie);
          }}
          inputValue={value}
          onInputChange={onValueChange}
          // Le texte tapé n'est pas obligé de correspondre à une suggestion : c'est toute la
          // différence entre une recherche et un sélecteur.
          allowsCustomValue
          // ⚠️ SANS CECI, « aucun résultat » n'existe pas. react-aria ferme le popover dès que la
          // collection est vide, donc le `renderEmptyState` de la ListBox n'est JAMAIS rendu :
          // l'utilisateur tape trois lettres qui ne donnent rien et la liste disparaît en silence,
          // sans lui dire si c'est vide ou cassé. Mesuré — la story `AucunResultat` ne rendait
          // aucune option ET aucun message. C'est l'état le plus fréquent d'une recherche.
          allowsEmptyCollection
          // `menuTrigger="focus"` (défaut HeroUI, explicité) : la liste s'ouvre à la prise de focus,
          // ce qui permet de proposer les catégories AVANT la première frappe plutôt qu'un vide.
          menuTrigger="focus"
          isInvalid={Boolean(error)}
          // Même raison que sur l'atome `Field` : `aria` plutôt que la validation native, qui bloque
          // la soumission avant que le gestionnaire React ne s'exécute (CLAUDE.md §11 point 11).
          validationBehavior="aria"
        >
          {/* ⚠️ `!ring-0` en plus de `!shadow-none`, et ce n'est pas de la ceinture-bretelles : sans
              lui, le champ affichait DEUX anneaux de focus imbriqués (relevé par Jérôme au rendu).
              `.input-group` de HeroUI pose le sien via `status-focused-field` sur
              `:has([data-slot=input-group-input]:focus)`, et `shadow-none` ne remet à zéro que
              `--tw-shadow` — l'anneau vit dans `--tw-ring-shadow`, un autre emplacement de la même
              propriété composée (mesuré : `oklch(…) 0 0 0 2px` subsistait). C'est l'anneau de la
              PILULE qu'on garde : lui seul entoure aussi le bouton. */}
          <InputGroup className="flex w-full items-center gap-1.5 !h-auto !border-0 !bg-transparent !shadow-none !ring-0 pl-1">
            {/* ⚠️ `!border-0` : le préfixe de HeroUI pose un FILET vertical entre la loupe et le
                texte (`border-inline-end`, au bleu de `--field-border`) — absent de la maquette.
                Marine, comme le texte : la loupe de la maquette n'est pas grisée. */}
            <InputGroup.Prefix className="!border-0 !px-2 text-[var(--default-foreground)]">
              {/* `aria-hidden`, comme dans l'atome `Button` : `Spinner` publie son propre
                  `role="status" aria-label="Loading"` (anglais, non traduit) — la seule annonce
                  vivante reste la région `role="status"` de `BuscadorInicio`. */}
              {isPending ? (
                <Spinner size="sm" color="current" aria-hidden="true" />
              ) : (
                <LoupeIcone />
              )}
            </InputGroup.Prefix>
            <InputGroup.Input
              // Anton (`--font-sous-titre`), marine plein, placeholder compris : c'est le texte de
              // la maquette (« ¿Qué buscas en Guatapé? »), composé dans la police des sous-titres.
              className="min-w-0 flex-1 font-[family-name:var(--font-sous-titre)] text-base text-[var(--default-foreground)] placeholder:text-[var(--default-foreground)] sm:text-lg"
              placeholder={placeholder}
              // ⚠️ OBLIGATOIRE, pas décoratif : sous `md` le bouton est masqué (§4), donc la touche
              // de validation du clavier virtuel est le SEUL moyen visible de lancer la recherche.
              // Sans cet attribut elle affiche « Retour » ou « OK » selon la plateforme, et
              // l'affordance sur laquelle repose toute la décision n'est pas communiquée.
              enterKeyHint="search"
              // ⚠️ `type="text"` — jamais `search`, malgré le nom. Chromium EFFACE nativement un
              // `input[type=search]` à `Échap` (mesuré), ce qui casserait « `Échap` ferme la liste
              // sans perdre le texte ». C'est aussi la forme exacte de la référence.
              type="text"
              onKeyDown={gererEntree}
              data-testid={sousId(testId, "input")}
            />
          </InputGroup>

          <ComboBox.Popover>
            {/* `items=` + enfants-en-fonction, pas un `.map()` : c'est ce qui fait détecter la liste
                vide par `renderEmptyState` (CLAUDE.md §2.3, même idiome que `SearchableCombobox`). */}
            <ListBox
              items={suggestions}
              renderEmptyState={() => (
                <p className="p-3 text-sm text-muted" data-testid={sousId(testId, "empty")}>
                  {emptyLabel}
                </p>
              )}
            >
              {(suggestion: SearchSuggestion) => (
                <ListBox.Item
                  key={suggestion.id}
                  id={suggestion.id}
                  textValue={suggestion.label}
                  // Fourni : l'option devient un vrai `<a role="option" href>`.
                  href={suggestion.href}
                  data-kind={suggestion.kind}
                  // ⚠️ `min-h-11` = 44 px, la cible tactile exigée par le README. Une suggestion à
                  // une seule ligne y descendrait sans ça, et c'est exactement sur une liste dense en
                  // écran étroit que la règle casse.
                  // ⚠️ `items-start text-left` : sans eux les deux lignes se rendaient CENTRÉES,
                  // la classe `.list-box__item` de HeroUI alignant au centre pour ses items d'une
                  // seule ligne. Constaté au rendu, invisible autrement.
                  className="flex min-h-11 flex-col items-start justify-center gap-0.5 px-3 py-2 text-left"
                >
                  <span className="text-base">{suggestion.label}</span>
                  {/* La nature et le lieu vivent ICI, en ligne secondaire — pas dans des intitulés de
                      groupe. Vérifié sur la référence : sa liste est plate, sans un seul
                      `role="group"`. Ça mélange les natures par pertinence plutôt que par type, et ça
                      évite les intitulés non sélectionnables qui compliquent la navigation clavier. */}
                  {suggestion.meta ? (
                    <span className="text-sm text-muted">{suggestion.meta}</span>
                  ) : null}
                </ListBox.Item>
              )}
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>

        {/* La croix de la maquette : vide le champ et RAMÈNE le focus dans le champ (voir `pilule`).
            Seulement quand il y a du texte — voir `clearLabel`. */}
        {clearLabel && value !== "" ? (
          <IconButton
            icon={<CroixIcone />}
            label={clearLabel}
            onPress={() => {
              onValueChange("");
              pilule.current?.querySelector("input")?.focus();
            }}
            testId={sousId(testId, "clear")}
          />
        ) : null}

        {/* ⚠️ EXCEPTION ASSUMÉE à la règle « ne jamais masquer selon la largeur » du README. Cette
            règle protège le CONTENU INDEXABLE — Google indexe le mobile — et un bouton de
            soumission n'en est pas. Décision de Jérôme : pas de bouton sur mobile, le clavier
            suffit, et à 390 px un grand champ plus un bouton ne tiennent pas côte à côte sans que
            l'un des deux devienne minuscule.
            ⚠️ MASQUÉ VISUELLEMENT, JAMAIS RETIRÉ DU DOM, et c'est là qu'est la décision : un
            lecteur d'écran mobile ne présente pas la touche de validation du clavier comme un
            bouton, et quelqu'un qui referme son clavier en touchant ailleurs n'aurait plus rien
            pour soumettre. `focus-within:not-sr-only` le fait réapparaître dès qu'il reçoit le
            focus, pour qu'un utilisateur clavier ne tabule jamais vers un contrôle invisible.
            ⚠️ MASQUÉ À TOUTES LES LARGEURS depuis la maquette de l'accueil (2026-10-01), qui n'en
            montre aucun, ordinateur compris : `Entrée` cherche, et le bouton réapparaît toujours au
            focus clavier. Ce n'est plus une exception de largeur — il n'y a plus de largeur. */}
        <div className="sr-only focus-within:not-sr-only">
          {/* ⚠️ `size="md"` et `shape="pill"` — demande de Jérôme du 2026-09-02 : plus bas et
              complètement arrondi, pour qu'il se loge dans la pilule au lieu de la contredire.
              `shape` a été ajouté à l'atome `Button` pour ça, son rayon y était figé dans une
              constante.
              `md` mesure 44 px depuis le plan 41 (item F4) : comme toute la famille, il ne descend
              plus sous la cible tactile, à aucune largeur. */}
          <Button
            type="button"
            size="md"
            shape="pill"
            onPress={() => onSubmit(value)}
            isPending={isPending}
            pendingLabel={pendingLabel}
            testId={sousId(testId, "submit")}
          >
            {submitLabel}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="error-message" role="alert" data-testid={sousId(testId, "error")}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted" data-testid={sousId(testId, "hint")}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
