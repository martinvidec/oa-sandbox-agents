# Schema-Dokumentation der Workflow-DSL

> Generiert aus `scripts/dsl-schemas.mjs` via `node scripts/generate-schema-docs.mjs`.
> Keys und zulässige Werte sind als JSON-Schemata im Validator definiert — hier als lesbarer
> Auszug. Normative Quelle bleibt das Schema; Änderungen gehören in `scripts/dsl-schemas.mjs`,
> danach das Skript erneut ausführen (`node scripts/generate-schema-docs.mjs`).
>
> **Legende:** `*` = Pflichtfeld (im `required`-Array). Alle Objekte sind streng — unbekannte
> Keys werden vom Validator (ajv) hart abgelehnt. Freitextfelder (`source`, `description`,
> `reason` …) sind bewusst locker; wo Ebene 2 (Konsistenzprüfung) semantisch prüft, steht im
> Schema nur ``type: string``, damit der Befund mit Begründung aus der Prüfung kommt.

## registry.yaml

### `registrySchema`

Top-Level-Keys (alle mit `additionalProperties: false` — keine Extra-Keys):

Pflicht: `version`, `source`, `workflows`

- `version` * — `1`
- `source` * — `string`, minLength: 1
- `workflows` * — `array`, minItems: 1, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`
    - `description` * — `string`, minLength: 1
    - `active` * — `boolean`

## roles.yaml

### `rolesSchema`

Top-Level-Keys (alle mit `additionalProperties: false` — keine Extra-Keys):

Pflicht: `version`, `source`, `forbidden_tools`, `d2_prose_check`, `roles`

- `version` * — `1`
- `source` * — `string`, minLength: 1
- `forbidden_tools` * — `array`, array of objects
  - Item:
    - `pattern` * — `string`, minLength: 1
    - `directive` * — `string`, pattern: `^D[1-8]$`
    - `reason` * — `string`, minLength: 1
    - `match` — enum: `subsumption` | `blanket` | `konvention`
    - `except` — `array`, minItems: 1, uniqueItems, array of `string`
- `d2_prose_check` * — `object`, object
  - `file` * — `string`, minLength: 1
  - `excluded_entries` * — `array`, uniqueItems, array of objects
    - Item:
      - `entry` * — `string`, minLength: 1
      - `side` * — enum: `agents_md` | `roles_yaml`
      - `directive` * — `string`, pattern: `^D[1-8]$`
      - `reason` * — `string`, minLength: 1
  - `foreign_set_blocks` — `array`, uniqueItems, array of objects
    - Item:
      - `label` * — `string`, minLength: 1
      - `reason` * — `string`, minLength: 1
- `roles` * — `array`, minItems: 1, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[a-z][a-z0-9_]*$`
    - `name` * — `string`, minLength: 1
    - `realization` * — `string`, minLength: 1
    - `scope` * — `string`, minLength: 1
    - `d2_set` * — `boolean`
    - `merge_allowed` * — `boolean`
    - `delegated` — `boolean`
    - `workdir` — enum: `repo-root` | `worktree` | `n/a`
    - `budget` — `object`, anyOf (siehe unten), object
      - `max_turns` — `integer`, minimum: 1
      - `max_work_steps` — `integer`, minimum: 1
      - `source` * — `string`, minLength: 1
    - `allowed_tools` — `array`, minItems: 1, uniqueItems, array of `string`
    - `must_not_include` — `array`, uniqueItems, array of `string`
    - `forbidden_tools` — `array`, array of objects
      - Item:
        - `pattern` * — `string`, minLength: 1
        - `directive` * — `string`, pattern: `^D[1-8]$`
        - `reason` * — `string`, minLength: 1
        - `match` — enum: `subsumption` | `blanket` | `konvention`
        - `except` — `array`, minItems: 1, uniqueItems, array of `string`
    - `conditional_tools` — `array`, array of objects
      - Item:
        - `id` * — `string`, pattern: `^[a-z][a-z0-9_]*$`
        - `directive` * — `string`, pattern: `^D[1-8]$`
        - `reason` * — `string`, minLength: 1
        - `grants` — `array`, minItems: 1, uniqueItems, array of `string`
        - `denies` — `array`, minItems: 1, uniqueItems, array of `string`
        - `restrict_git_tools_to` — `array`, minItems: 1, uniqueItems, array of `string`

## states.yaml

### `statesSchema`

Top-Level-Keys (alle mit `additionalProperties: false` — keine Extra-Keys):

Pflicht: `version`, `source`, `initial`, `facts`, `states`, `label_table`, `transitions`, `invariants`

- `version` * — `1`
- `source` * — `string`, minLength: 1
- `initial` * — `string`, minLength: 1
- `facts` * — `array`, minItems: 1, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[a-z][a-z0-9_]*$`
    - `description` * — `string`, minLength: 1
    - `check` * — `string`, minLength: 1
- `states` * — `array`, minItems: 2, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[a-z][a-z0-9_]*$`
    - `label` — `string`, minLength: 1
    - `set_by` — `string`, minLength: 1
    - `set_by_role` — `string`, minLength: 1
    - `set_by_role_fallback` — `string`, minLength: 1
    - `trigger` — `string`, minLength: 1
    - `description` * — `string`, minLength: 1
    - `terminal` * — `boolean`
- `label_table` * — `array`, minItems: 1, array of objects
  - Item:
    - `states` * — `array`, minItems: 1, array of `string`
    - `label` — `string`, minLength: 1
    - `set_by` — `string`, minLength: 1
    - `trigger` — `string`, minLength: 1
- `transitions` * — `array`, minItems: 1, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[a-z][a-z0-9_]*$`
    - `from` * — `string`
    - `to` * — `string`
    - `owner` * — `string`, minLength: 1
    - `owner_fallback` — `string`, minLength: 1
    - `trigger` * — `string`, minLength: 1
    - `requires` — `array`, minItems: 1, uniqueItems, array of `string`
    - `loop` — `boolean`
    - `directive` — `string`, pattern: `^D[1-8]$`
    - `source` — `string`, minLength: 1
- `invariants` * — `object`, object
  - `max_review_loops` * — `integer`, minimum: 1
  - `loop_transition` * — `string`
  - `loop_escape` * — `string`
  - `done_state` * — `string`
  - `done_by` * — `string`
  - `done_requires` * — `array`, minItems: 1, uniqueItems, array of `string`

## rules.yaml

### `rulesSchema`

Top-Level-Keys (alle mit `additionalProperties: false` — keine Extra-Keys):

Pflicht: `version`, `source`, `check_sources`, `triggers`, `facts`, `rules`, `documented_conventions`

- `version` * — `1`
- `source` * — `string`, minLength: 1
- `check_sources` * — `array`, minItems: 1, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[a-z][a-z0-9_]*$`
    - `description` * — `string`, minLength: 1
    - `infrastructure` * — `string`, minLength: 1
- `triggers` * — `array`, minItems: 1, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[a-z][a-z0-9_]*$`
    - `description` * — `string`, minLength: 1
    - `observable_via` * — `string`, minLength: 1
    - `pipeline` * — `boolean`
- `facts` * — `array`, minItems: 1, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[a-z][a-z0-9_]*$`
    - `description` * — `string`, minLength: 1
    - `check` * — `string`, minLength: 1
    - `command` * — `string`, minLength: 1
- `rules` * — `array`, minItems: 1, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[A-Za-z][A-Za-z0-9_]*$`
    - `directive` — `string`, pattern: `^D[1-8]$`
    - `on` * — `string`, minLength: 1
    - `assert` * — `object`, object
      - `fact` — `string`, minLength: 1
      - `operator` — `string`, minLength: 1
      - `value` — beliebig
      - `values` — `array`, minItems: 1
      - `all_of` — `array`, minItems: 1, array of objects
        - Item:
          - `fact` — `string`, minLength: 1
          - `operator` — `string`, minLength: 1
          - `value` — beliebig
          - `values` — `array`, minItems: 1
      - `any_of` — `array`, minItems: 1, array of objects
        - Item:
          - `fact` — `string`, minLength: 1
          - `operator` — `string`, minLength: 1
          - `value` — beliebig
          - `values` — `array`, minItems: 1
    - `check` * — `string`, minLength: 1
    - `remedy` * — `string`, minLength: 1
    - `source` * — `object`, object
      - `agents_md` — `string`, minLength: 1
      - `doc` — `string`, minLength: 1
    - `runtime_checkable` — `boolean`
    - `check_hint` — `string`, minLength: 1
- `documented_conventions` * — `array`, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[A-Za-z][A-Za-z0-9_]*$`
    - `directive` — `string`, pattern: `^D[1-8]$`
    - `convention` * — `string`, minLength: 1
    - `why_not_checkable` * — `string`, minLength: 1
    - `source` * — `object`, object
      - `agents_md` — `string`, minLength: 1
      - `doc` — `string`, minLength: 1

## pipeline.yaml

### `pipelineSchema`

Top-Level-Keys (alle mit `additionalProperties: false` — keine Extra-Keys):

Pflicht: `version`, `source`, `first`, `steps`

- `version` * — `1`
- `source` * — `string`, minLength: 1
- `first` * — `string`, minLength: 1
- `steps` * — `array`, minItems: 1, array of objects
  - Item:
    - `id` * — `string`, pattern: `^[a-z][a-z0-9_]*$`
    - `name` * — `string`, minLength: 1
    - `actor` * — `string`, minLength: 1
    - `workdir` * — enum: `repo-root` | `worktree` | `n/a`
    - `delegated` * — `boolean`
    - `description` * — `string`, minLength: 1
    - `state_before` * — `string`, minLength: 1
    - `state_after` * — `string`, minLength: 1
    - `preconditions` * — `array`, array of objects
      - Item:
        - `label_check` — `object`, object
          - `state` * — `string`, minLength: 1
          - `present` * — `boolean`
        - `actor_check` — `object`, object
          - `role` * — `string`, minLength: 1
        - `ci_check` — `object`, object
          - `conclusion` * — `string`, minLength: 1
        - `fact_check` — `object`, object
          - `fact` * — `string`, minLength: 1
          - `expected` * — beliebig
    - `postconditions` * — `array`, array of objects
      - Item:
        - `label_check` — `object`, object
          - `state` * — `string`, minLength: 1
          - `present` * — `boolean`
        - `actor_check` — `object`, object
          - `role` * — `string`, minLength: 1
        - `ci_check` — `object`, object
          - `conclusion` * — `string`, minLength: 1
        - `fact_check` — `object`, object
          - `fact` * — `string`, minLength: 1
          - `expected` * — beliebig
    - `rules` — `array`, uniqueItems, array of `string`
    - `next` * — `array`, uniqueItems, array of `string`
    - `loop` — `object`, object
      - `to` * — `string`, minLength: 1
      - `transition` * — `string`, minLength: 1
      - `trigger` — `string`, minLength: 1
      - `max` * — `integer`, minimum: 1

