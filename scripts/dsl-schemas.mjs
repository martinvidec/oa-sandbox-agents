// Schema-Definitionen der Workflow-DSL (extrahiert aus scripts/validate-workflow.mjs, Issue #68).
// Quelle: docs/specs/dsl-workflow.md, § 3 — Ebene 1: Schema.
// Diese Konstanten sind die normative Quelle der DSL-Struktur (JSON-Schemata, ajv) und werden
// von scripts/validate-workflow.mjs (Validierung) und scripts/generate-schema-docs.mjs
// (Dokumentation, Issue #68) genutzt.

// ------------------------------------------------------------------------ Ebene 1: Schemata

const toolEntry = { type: 'string', minLength: 1 };
const forbiddenList = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false,
    required: ['pattern', 'directive', 'reason'],
    properties: {
      pattern: toolEntry,
      directive: { type: 'string', pattern: '^D[1-8]$' },
      reason: { type: 'string', minLength: 1 },
      match: { enum: ['subsumption', 'blanket', 'konvention'] },
      except: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
    },
  },
};

// Ausnahmen des D2-Prosa-Abgleichs: strukturiert, mit Seite, Direktive und Begründung. `side`
// sagt, wo der Eintrag steht und deshalb auf der anderen Seite fehlen darf — `agents_md`: in der
// D2-Prosa genannt, bewusst ohne DSL-Eintrag; `roles_yaml`: Allowlist-Eintrag ohne Prosa-Beleg.
const d2ProseCheckSchema = {
  type: 'object', additionalProperties: false,
  required: ['file', 'excluded_entries'],
  properties: {
    file: { type: 'string', minLength: 1 },
    excluded_entries: {
      type: 'array', uniqueItems: true,
      items: {
        type: 'object', additionalProperties: false,
        required: ['entry', 'side', 'directive', 'reason'],
        properties: {
          entry: toolEntry,
          side: { enum: ['agents_md', 'roles_yaml'] },
          directive: { type: 'string', pattern: '^D[1-8]$' },
          reason: { type: 'string', minLength: 1 },
        },
      },
    },
    // Set-Punkte der D2-Prosa, die zu keiner Rolle DIESER Instanz gehören (Issue #58) —
    // deklariert, nicht still übersprungen; der Abgleich meldet Deklarationen ohne Bezug
    // (`fremdblock-ohne-bezug`) und Kollisionen mit einer vorhandenen Rolle
    // (`fremdblock-kollidiert`).
    foreign_set_blocks: {
      type: 'array', uniqueItems: true,
      items: {
        type: 'object', additionalProperties: false,
        required: ['label', 'reason'],
        properties: { label: toolEntry, reason: { type: 'string', minLength: 1 } },
      },
    },
  },
};

const rolesSchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'forbidden_tools', 'd2_prose_check', 'roles'],
  properties: {
    version: { const: 1 },
    source: { type: 'string', minLength: 1 },
    forbidden_tools: forbiddenList,
    d2_prose_check: d2ProseCheckSchema,
    roles: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'realization', 'scope', 'd2_set', 'merge_allowed'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          name: { type: 'string', minLength: 1 },
          realization: { type: 'string', minLength: 1 },
          scope: { type: 'string', minLength: 1 },
          d2_set: { type: 'boolean' },
          merge_allowed: { type: 'boolean' },
          delegated: { type: 'boolean' },
          workdir: { enum: ['repo-root', 'worktree', 'n/a'] },
          // Budget-Cap: `max_turns` (headless Claude-Code-Runs) ODER `max_work_steps`
          // (Hermes-Sub-Agent-Runs, Issue #58); welche Grenze greift, prüft `budgetGrenze`.
          budget: {
            type: 'object', additionalProperties: false,
            required: ['source'],
            anyOf: [
              { required: ['max_turns'] },
              { required: ['max_work_steps'] },
            ],
            properties: {
              max_turns: { type: 'integer', minimum: 1 },
              max_work_steps: { type: 'integer', minimum: 1 },
              source: { type: 'string', minLength: 1 },
            },
          },
          allowed_tools: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
          must_not_include: { type: 'array', uniqueItems: true, items: toolEntry },
          forbidden_tools: forbiddenList,
          conditional_tools: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['id', 'directive', 'reason'],
              properties: {
                id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
                directive: { type: 'string', pattern: '^D[1-8]$' },
                reason: { type: 'string', minLength: 1 },
                grants: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
                denies: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
                restrict_git_tools_to: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
              },
            },
          },
        },
      },
    },
  },
};

const statesSchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'initial', 'facts', 'states', 'label_table', 'transitions', 'invariants'],
  properties: {
    version: { const: 1 },
    source: { type: 'string', minLength: 1 },
    initial: { type: 'string', minLength: 1 },
    facts: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'check'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          description: { type: 'string', minLength: 1 },
          check: { type: 'string', minLength: 1 },
        },
      },
    },
    states: {
      type: 'array', minItems: 2,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'terminal'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          label: { type: 'string', minLength: 1 },
          set_by: { type: 'string', minLength: 1 },
          set_by_role: { type: 'string', minLength: 1 },
          set_by_role_fallback: { type: 'string', minLength: 1 },
          trigger: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          terminal: { type: 'boolean' },
        },
      },
    },
    label_table: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['states'],
        properties: {
          states: { type: 'array', minItems: 1, items: { type: 'string' } },
          label: { type: 'string', minLength: 1 },
          set_by: { type: 'string', minLength: 1 },
          trigger: { type: 'string', minLength: 1 },
        },
      },
    },
    transitions: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'from', 'to', 'owner', 'trigger'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          from: { type: 'string' },
          to: { type: 'string' },
          owner: { type: 'string', minLength: 1 },
          owner_fallback: { type: 'string', minLength: 1 },
          trigger: { type: 'string', minLength: 1 },
          requires: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
          loop: { type: 'boolean' },
          // Herkunft der Regel: eine Direktive aus AGENTS.md ODER eine andere Quelle
          // (`source`). Mindestens eines von beiden muss stehen — geprüft in Ebene 2.
          directive: { type: 'string', pattern: '^D[1-8]$' },
          source: { type: 'string', minLength: 1 },
        },
      },
    },
    invariants: {
      type: 'object', additionalProperties: false,
      required: ['max_review_loops', 'loop_transition', 'loop_escape', 'done_state', 'done_by', 'done_requires'],
      properties: {
        max_review_loops: { type: 'integer', minimum: 1 },
        loop_transition: { type: 'string' },
        loop_escape: { type: 'string' },
        done_state: { type: 'string' },
        done_by: { type: 'string' },
        done_requires: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
      },
    },
  },
};

// Schemata für rules.yaml und pipeline.yaml. Bewusst locker, wo Ebene 2d/2e semantisch prüft:
// `infrastructure`, `check`, `on`, `operator` und `conclusion` stehen hier als freie Strings,
// damit der Befund aus der Konsistenzprüfung kommt (mit Begründung und Selbsttest-Fall) und
// nicht als nackter Enum-Fehler aus ajv.
const nichtLeer = { type: 'string', minLength: 1 };
const dslId = { type: 'string', pattern: '^[a-z][a-z0-9_]*$' };
const regelId = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' };
const direktive = { type: 'string', pattern: '^D[1-8]$' };
const quelleSchema = {
  type: 'object', additionalProperties: false,
  properties: { agents_md: nichtLeer, doc: nichtLeer },
};
const assertBlatt = {
  type: 'object', additionalProperties: false,
  properties: { fact: nichtLeer, operator: nichtLeer, value: {}, values: { type: 'array', minItems: 1 } },
};
const assertSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    fact: nichtLeer, operator: nichtLeer, value: {}, values: { type: 'array', minItems: 1 },
    all_of: { type: 'array', minItems: 1, items: assertBlatt },
    any_of: { type: 'array', minItems: 1, items: assertBlatt },
  },
};

const rulesSchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'check_sources', 'triggers', 'facts', 'rules', 'documented_conventions'],
  properties: {
    version: { const: 1 },
    source: nichtLeer,
    check_sources: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'infrastructure'],
        properties: { id: dslId, description: nichtLeer, infrastructure: nichtLeer },
      },
    },
    triggers: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'observable_via', 'pipeline'],
        properties: { id: dslId, description: nichtLeer, observable_via: nichtLeer, pipeline: { type: 'boolean' } },
      },
    },
    facts: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'check', 'command'],
        // `command` ist Pflicht: Ohne den Befehl, mit dem sich der Fakt ablesen lässt, wäre
        // „beobachtbar" eine Behauptung (Spec § 2, keine Selbstauskunft).
        properties: { id: dslId, description: nichtLeer, check: nichtLeer, command: nichtLeer },
      },
    },
    rules: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'on', 'assert', 'check', 'remedy', 'source'],
        properties: {
          id: regelId, directive: direktive, on: nichtLeer, assert: assertSchema,
          check: nichtLeer, remedy: nichtLeer, source: quelleSchema,
          // Runtime-Replay-Metadaten (Ebene 3): Jede Regel deklariert, ob der Replay sie
          // aus den beobachtbaren Daten subsumieren kann; `check_hint` sagt, wie.
          runtime_checkable: { type: 'boolean' }, check_hint: nichtLeer,
        },
      },
    },
    // `directive` ist optional — wie bei `rules`: Nicht jede Konvention hängt an einer
    // Direktive (der Cleanup steht in der Worktree-Konvention von AGENTS.md). Eine Direktive
    // zu erfinden, nur damit das Pflichtfeld gefüllt ist, wäre der falsche Verweis an
    // normativer Stelle; die Abdeckungsprüfung D1–D8 zählt ohnehin nur Einträge mit Feld.
    documented_conventions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'convention', 'why_not_checkable', 'source'],
        properties: {
          id: regelId, directive: direktive, convention: nichtLeer,
          why_not_checkable: nichtLeer, source: quelleSchema,
        },
      },
    },
  },
};

// Bedingungen: die vier Formen streng typisiert, unbekannte Schlüssel absichtlich erlaubt —
// sie meldet Ebene 2e als `unbekannte-bedingung` samt Aufzählung der zulässigen Formen.
const bedingungSchema = {
  type: 'object', minProperties: 1, additionalProperties: true,
  properties: {
    label_check: { type: 'object', additionalProperties: false, required: ['state', 'present'], properties: { state: nichtLeer, present: { type: 'boolean' } } },
    actor_check: { type: 'object', additionalProperties: false, required: ['role'], properties: { role: nichtLeer } },
    ci_check: { type: 'object', additionalProperties: false, required: ['conclusion'], properties: { conclusion: nichtLeer } },
    fact_check: { type: 'object', additionalProperties: false, required: ['fact', 'expected'], properties: { fact: nichtLeer, expected: {} } },
  },
};

const pipelineSchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'first', 'steps'],
  properties: {
    version: { const: 1 },
    source: nichtLeer,
    first: nichtLeer,
    steps: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'actor', 'workdir', 'delegated', 'description', 'state_before', 'state_after', 'preconditions', 'postconditions', 'next'],
        properties: {
          id: dslId, name: nichtLeer, actor: nichtLeer,
          workdir: { enum: ['repo-root', 'worktree', 'n/a'] },
          delegated: { type: 'boolean' },
          description: nichtLeer,
          state_before: nichtLeer, state_after: nichtLeer,
          preconditions: { type: 'array', items: bedingungSchema },
          postconditions: { type: 'array', items: bedingungSchema },
          rules: { type: 'array', uniqueItems: true, items: nichtLeer },
          next: { type: 'array', uniqueItems: true, items: nichtLeer },
          loop: {
            type: 'object', additionalProperties: false,
            required: ['to', 'transition', 'max'],
            properties: { to: nichtLeer, transition: nichtLeer, trigger: nichtLeer, max: { type: 'integer', minimum: 1 } },
          },
        },
      },
    },
  },
};

// ------------------------------------------------------ Registry (workflow/registry.yaml)

// Schema: locker in den Freitextfeldern (description, source), hart bei `id` (slug-förmig) und
// `active` (Boolean — die Aktiv-Auswahl muss eindeutig lesbar sein, kein Wahrheits-Wildwuchs).
const registrySchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'workflows'],
  properties: {
    version: { const: 1 },
    source: nichtLeer,
    workflows: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'active'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' },
          description: nichtLeer,
          active: { type: 'boolean' },
        },
      },
    },
  },
};

export {
  toolEntry,
  forbiddenList,
  d2ProseCheckSchema,
  rolesSchema,
  statesSchema,
  nichtLeer,
  dslId,
  regelId,
  direktive,
  quelleSchema,
  assertBlatt,
  assertSchema,
  rulesSchema,
  bedingungSchema,
  pipelineSchema,
  registrySchema,
};
