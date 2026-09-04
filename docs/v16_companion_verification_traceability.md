# Verification and Traceability Companion Specification — v0.1 Draft

> **Status**: Draft / Proposed — M0 deliverable candidate for v1.6.0 PRD.
> **Scope**: Defines how every MUST in `docs/amazon_ai_ops_agent_prd_v1_6_0.md` is bound to a verifiable producer, an independent verifier, an evidence schema, an artifact hash, and a `PENDING/PASS/FAIL` result.
> **Out of scope** (this draft):
> - L4–L8 procedures that require Windows package runtime, formal DB forensics, real Ads canary, or continuous multi-store operation. Those layers are kept in a separate "**gated-bucket**" and always start as `PENDING` until user ban is lifted.
> - Migration & Compatibility and Release & Canary companion specs.

---

## 1. Document control

| Field | Value |
|---|---|
| Companion spec ID | `V16-COMPANION-VT` |
| Companion spec version | `0.1` |
| Companion spec status | `Draft` |
| Owner | Verification Engineering |
| Reviewers | Product, Architecture, Acceptance |
| Parent PRD | `docs/amazon_ai_ops_agent_prd_v1_6_0.md` v1.1 |
| Reads from | `docs/v16_companion_migration_compatibility.md` (not yet written), `docs/v16_companion_release_canary.md` (not yet written) |
| Required by | v1.6.0 L1–L8 acceptance workflow |

### 1.1 Versioning

- This spec itself is **versioned independently** of the PRD (`0.1`, `0.2`, …).
- Every change that affects evidence schema, required-test manifest format, or trace closure contract MUST increment the spec version and update downstream verifiers.
- The companion spec version is **not** a substitute for v1.6.0 release version.

---

## 2. Three contracts this spec defines

1. **Required-test manifest contract** (§3) — a single source of truth for which tests are required to be present, run, and pass for v1.6.0 acceptance.
2. **Evidence record contract** (§4) — the JSON shape every producer must emit and every verifier must consume.
3. **Trace closure contract** (§5) — how a MUST requirement is bound to ACs, layers, tests, fixtures, producers, verifiers, results, and identities.

All three contracts use stable IDs. Missing fields are not silently filled in by the verifier — they yield `BLOCKED / PENDING`.

---

## 3. Required-test manifest

### 3.1 Purpose

A versioned, machine-checkable manifest that lists every test required for v1.6.0 acceptance, organised by acceptance layer. The manifest is **the single source of truth** that drives:
- `pnpm run verify:v16-required-tests` — validates the manifest itself and the test files exist
- `pnpm run verify:v16-trace-closure` — validates every MUST in the PRD maps to at least one test in the manifest
- `pnpm run run:v16-evidence-aggregation` — runs producers in dependency order and aggregates per-layer results

### 3.2 File location

```
docs/v16_required_test_manifest.json
docs/v16_required_test_manifest.schema.json     # JSON Schema (draft-07)
scripts/verify-v16-required-test-manifest.js     # validator (CLI)
scripts/verify-v16-required-test-manifest.test.mjs  # vitest
```

### 3.3 Manifest top-level schema

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "title": "V16 Required Test Manifest",
  "type": "object",
  "required": [
    "manifestVersion",
    "prdReference",
    "companionSpec",
    "identity",
    "buckets",
    "tests"
  ],
  "properties": {
    "manifestVersion": { "type": "string", "pattern": "^\\d+\\.\\d+$" },
    "prdReference": {
      "type": "object",
      "required": ["path", "version"],
      "properties": {
        "path": { "type": "string" },
        "version": { "type": "string" }
      }
    },
    "companionSpec": {
      "type": "object",
      "required": ["id", "version"],
      "properties": {
        "id": { "const": "V16-COMPANION-VT" },
        "version": { "type": "string" }
      }
    },
    "identity": {
      "type": "object",
      "required": ["sourceRevision", "packageVersion"],
      "properties": {
        "sourceRevision": { "type": "string", "description": "git commit SHA or worktree tag at the time the manifest was authored" },
        "packageVersion": { "type": "string", "pattern": "^v16\\.\\d+\\.\\d+", "description": "semver of the v1.6.0 release the manifest targets" }
      }
    },
    "buckets": {
      "type": "object",
      "required": ["active", "gated"],
      "properties": {
        "active": {
          "type": "array",
          "items": { "$ref": "#/$defs/bucket" },
          "description": "Layers and tests that can be executed under current user ban"
        },
        "gated": {
          "type": "array",
          "items": { "$ref": "#/$defs/bucket" },
          "description": "Layers/tests blocked behind user ban (always PENDING)"
        }
      }
    },
    "tests": {
      "type": "array",
      "items": { "$ref": "#/$defs/testEntry" }
    }
  },
  "$defs": {
    "bucket": {
      "type": "object",
      "required": ["bucketId", "label", "layer", "producer", "verifier", "blockedBy"],
      "properties": {
        "bucketId": { "type": "string", "pattern": "^[A-Z0-9_-]+$" },
        "label": { "type": "string" },
        "layer": { "enum": ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"] },
        "producer": { "type": "string", "description": "PNPM script that produces the bucket's evidence file" },
        "verifier": { "type": "string", "description": "PNPM script that validates the evidence file" },
        "blockedBy": {
          "type": "array",
          "items": { "enum": ["user-ban-app-control", "user-ban-typecheck", "user-ban-smoke", "user-ban-package-ui", "user-ban-zip-launch", "user-ban-formal-db", "user-ban-real-ads"] },
          "description": "Empty array means the bucket is runnable today"
        }
      }
    },
    "testEntry": {
      "type": "object",
      "required": [
        "testId",
        "requirementIds",
        "acceptanceIds",
        "layer",
        "bucketId",
        "producer",
        "verifier",
        "evidenceSchemaRef",
        "identityBindings"
      ],
      "properties": {
        "testId": { "type": "string", "pattern": "^V16-T-[A-Z0-9_-]+$" },
        "requirementIds": { "type": "array", "items": { "type": "string", "pattern": "^V16-[A-Z0-9-]+$" } },
        "acceptanceIds": { "type": "array", "items": { "type": "string", "pattern": "^AC-[A-Z0-9-]+$" } },
        "layer": { "enum": ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"] },
        "bucketId": { "type": "string" },
        "producer": {
          "type": "object",
          "required": ["script", "args", "producesArtifact"],
          "properties": {
            "script": { "type": "string" },
            "args": { "type": "array", "items": { "type": "string" } },
            "producesArtifact": { "type": "string", "description": "Glob pattern relative to repo root" }
          }
        },
        "verifier": {
          "type": "object",
          "required": ["script", "consumesArtifact", "resultKind"],
          "properties": {
            "script": { "type": "string" },
            "consumesArtifact": { "type": "string" },
            "resultKind": { "enum": ["boolean", "structured-gate", "structural-validate"] }
          }
        },
        "evidenceSchemaRef": { "type": "string", "description": "Path to evidence JSON Schema, relative to repo root" },
        "identityBindings": {
          "type": "array",
          "items": { "enum": ["sourceRevision", "packageVersion", "packageSha256", "dbIdentity", "fixtureIdentity"] }
        },
        "blocking": { "type": "array", "items": { "type": "string" } },
        "notes": { "type": "string" }
      }
    }
  }
}
```

### 3.4 Bucket / layer assignment rules

| Layer | Active bucket today? | Reason |
|---|---|---|
| L1 单元与合同 | **Yes** | Can run vitest against `apps/desktop/src/main/**` and `packages/**` |
| L2 静态工程 (typecheck / renderer build / package script contracts) | **Yes** | User permits these per PRD §0.4 historical record |
| L3 业务集成 smoke | **Yes** (development UI smoke only) | User permits dev-environment smoke; Package UI stays gated |
| L4 Package UI (100% / 125% / wide / a11y delta) | **No** — gated-bucket | Requires Windows package runtime |
| L5 Package security (launch / nav / external / node env / 三重 hash) | **No** — gated-bucket | Requires Windows package runtime |
| L6 正式 DB (WAL-safe / readonly / two-store × seven days) | **No** — gated-bucket | User prohibits current-package formal-DB pre/post |
| L7 Canary (manual + policy-auto, two independent sessions) | **No** — gated-bucket | User prohibits real Ads validation |
| L8 Readiness / publication closure | **Partial** — aggregation runs; final result always `APP_NEEDS_WORK` while L4–L7 are gated | Aggregation can be exercised against PENDING inputs |

**Rule**: any test whose `bucketId` is in the gated bucket **must** have `result = PENDING` at run time, regardless of whether the underlying producer would otherwise pass. The aggregator MUST NOT mark such a test as `PASS` even if the script exits 0.

### 3.5 PENDING vs FAIL semantics

| Result | Meaning | Trigger |
|---|---|---|
| `PASS` | Producer ran, verifier ran, all identity bindings matched, all blocking gates closed | Happy path |
| `FAIL` | Producer ran and verifier found a violation OR identity mismatch OR a blocking gate failed | Concrete defect |
| `PENDING` | (a) bucket is in gated bucket list, **or** (b) producer not yet wired, **or** (c) input fixture not yet provisioned | Either bucket-gated or explicit non-failure |
| `BLOCKED` | Producer ran but a precondition (e.g., no current StoreContext, no schema, no auth) is not satisfied in the test environment | Environment issue, not test defect |

**Critical rule**: `PENDING` and `BLOCKED` are distinct. The aggregator MUST count:
- `FAIL` counts toward `needsWork`
- `PENDING` counts toward `gated`
- `BLOCKED` counts toward `needsWork` (environment must be fixed before claiming PASS)
- `PASS` counts toward `releaseReady`

---

## 4. Evidence record contract

### 4.1 File location pattern

All evidence files are written under `output/v16-evidence/`. Producer scripts MUST write exactly one JSON file per invocation, plus optional auxiliary files in the same subdirectory.

```
output/v16-evidence/
  v16_required_test_manifest_validation.json
  v16_trace_closure.json
  v16_l1_unit_contract.json
  v16_l2_static_engineering.json
  v16_l3_business_integration_dev.json
  v16_l4_package_ui.json              (gated — never written under user ban)
  v16_l5_package_security.json         (gated)
  v16_l6_formal_db.json                (gated)
  v16_l7_canary.json                   (gated)
  v16_l8_readiness_aggregation.json    (always produced; aggregates gated buckets as PENDING)
  auxiliary/                           (producers may write binary fixtures here)
```

### 4.2 Evidence record schema (common envelope)

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "title": "V16 Evidence Record",
  "type": "object",
  "required": [
    "schemaVersion",
    "evidenceKind",
    "producer",
    "verifier",
    "result",
    "resultDetail",
    "identity",
    "producedAt",
    "consumedInputs"
  ],
  "properties": {
    "schemaVersion": { "const": "v16.evidence/0.1" },
    "evidenceKind": {
      "type": "string",
      "enum": [
        "manifest-validation",
        "trace-closure",
        "l1-unit-contract",
        "l2-static-engineering",
        "l3-business-integration-dev",
        "l4-package-ui",
        "l5-package-security",
        "l6-formal-db",
        "l7-canary",
        "l8-readiness-aggregation"
      ]
    },
    "producer": {
      "type": "object",
      "required": ["script", "command", "host", "exitCode"],
      "properties": {
        "script": { "type": "string" },
        "command": { "type": "string" },
        "host": { "type": "string" },
        "exitCode": { "type": "integer" }
      }
    },
    "verifier": {
      "type": "object",
      "required": ["script", "exitCode", "validatedAt"],
      "properties": {
        "script": { "type": "string" },
        "exitCode": { "type": "integer" },
        "validatedAt": { "type": "string", "format": "date-time" }
      }
    },
    "result": { "enum": ["PASS", "FAIL", "PENDING", "BLOCKED"] },
    "resultDetail": { "type": "string", "description": "Free-form diagnostic; verifier-set, not operator-set" },
    "identity": { "$ref": "#/$defs/identity" },
    "producedAt": { "type": "string", "format": "date-time" },
    "consumedInputs": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["kind", "ref", "sha256"],
        "properties": {
          "kind": { "enum": ["sourceRevision", "packageArtifact", "dbSnapshot", "fixture", "manifest"] },
          "ref": { "type": "string" },
          "sha256": { "type": "string", "pattern": "^[A-F0-9]{64}$" }
        }
      }
    },
    "tests": {
      "type": "array",
      "items": { "$ref": "#/$defs/testResult" }
    },
    "blockers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "message", "target"],
        "properties": {
          "code": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]+$" },
          "message": { "type": "string" },
          "target": { "type": "string", "description": "testId, bucketId, or acceptanceId this blocker affects" }
        }
      }
    }
  },
  "$defs": {
    "identity": {
      "type": "object",
      "required": ["sourceRevision", "packageVersion"],
      "properties": {
        "sourceRevision": { "type": "string" },
        "packageVersion": { "type": "string", "pattern": "^v16\\.\\d+\\.\\d+" },
        "packageSha256": {
          "type": "object",
          "description": "Optional, present when an installer/portable/ZIP/win-unpacked EXE has been produced",
          "properties": {
            "installer": { "type": "string", "pattern": "^[A-F0-9]{64}$" },
            "portable": { "type": "string", "pattern": "^[A-F0-9]{64}$" },
            "folderZip": { "type": "string", "pattern": "^[A-F0-9]{64}$" },
            "winUnpackedExe": { "type": "string", "pattern": "^[A-F0-9]{64}$" },
            "mainBundle": { "type": "string", "pattern": "^[A-F0-9]{64}$" }
          }
        },
        "dbIdentity": {
          "type": "object",
          "description": "Optional, present when a DB snapshot is consumed",
          "properties": {
            "path": { "type": "string" },
            "sha256": { "type": "string", "pattern": "^[A-F0-9]{64}$" },
            "schemaVersion": { "type": "string" },
            "storeCount": { "type": "integer", "minimum": 0 },
            "productionFullLineage": { "type": "boolean" }
          }
        }
      }
    },
    "testResult": {
      "type": "object",
      "required": ["testId", "result"],
      "properties": {
        "testId": { "type": "string", "pattern": "^V16-T-[A-Z0-9_-]+$" },
        "result": { "enum": ["PASS", "FAIL", "PENDING", "BLOCKED"] },
        "details": { "type": "string" },
        "blockingGates": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    }
  }
}
```

### 4.3 Verifier independence

Every verifier MUST satisfy the following:

1. The verifier script path MUST NOT be the same as the producer script path.
2. The verifier MUST re-read the evidence file from disk; it MUST NOT trust in-memory state from the producer.
3. The verifier MUST compute the SHA-256 of every consumed input and compare against the recorded `consumedInputs[].sha256`. Mismatch → `FAIL` with code `IDENTITY_BINDING_MISMATCH`.
4. The verifier MUST refuse to evaluate evidence whose `schemaVersion` is higher than the verifier's `schemaVersion`. Lower → `FAIL` with code `SCHEMA_VERSION_TOO_OLD`; higher → `BLOCKED` with code `SCHEMA_VERSION_TOO_NEW` (verifier must be updated first).

### 4.4 Identity binding rules

- `sourceRevision` MUST be a git commit SHA or explicit `uncommitted:<timestamp>` tag. Worktrees without a committed HEAD MUST report `sourceRevision = uncommitted:<UTC ISO timestamp>`.
- `packageVersion` MUST match the `package.json` `version` field for `@amazon-ai-ops/desktop`. Mismatch is `FAIL`.
- `packageSha256` is required only for L4/L5/L8 evidence. Producers for L1/L2/L3 may omit it.
- `dbIdentity` is required only for L6 evidence.

---

## 5. Trace closure contract

### 5.1 Purpose

A trace closure record binds every PRD MUST to:
- the ACs that validate it (PRD §21.2 table),
- the L1–L8 layers where the AC is exercised,
- the required-test manifest entries that produce the evidence,
- the producer/verifier pair,
- the current `result` (`PENDING/PASS/FAIL/BLOCKED`).

Closing the trace means: for every MUST, the verifier can answer "given the current evidence, what is the most recent `result` for each AC it cites, and which producer/verifier produced that result?".

### 5.2 File location

```
docs/v16_trace_closure.json
scripts/verify-v16-trace-closure.js        # regenerates the file from PRD + manifest + evidence
scripts/verify-v16-trace-closure.test.mjs
```

### 5.3 Trace record schema

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "title": "V16 Trace Closure",
  "type": "object",
  "required": [
    "schemaVersion",
    "prdReference",
    "companionSpec",
    "producedAt",
    "identity",
    "closedAt",
    "requirements"
  ],
  "properties": {
    "schemaVersion": { "const": "v16.trace/0.1" },
    "prdReference": { "$ref": "evidence.schema.json#/$defs/identity" },
    "companionSpec": {
      "type": "object",
      "required": ["id", "version"],
      "properties": {
        "id": { "const": "V16-COMPANION-VT" },
        "version": { "type": "string" }
      }
    },
    "producedAt": { "type": "string", "format": "date-time" },
    "identity": { "$ref": "evidence.schema.json#/$defs/identity" },
    "closedAt": { "type": "string", "format": "date-time", "description": "Set by the verifier after cross-checking evidence" },
    "summary": {
      "type": "object",
      "required": ["total", "closed", "pending", "failed", "blocked"],
      "properties": {
        "total": { "type": "integer" },
        "closed": { "type": "integer", "description": "Requirements with at least one PASS AC and zero FAIL" },
        "pending": { "type": "integer", "description": "Requirements whose ACs are all PENDING or BLOCKED" },
        "failed": { "type": "integer", "description": "Requirements with at least one FAIL AC and zero PASS for that AC" },
        "blocked": { "type": "integer", "description": "Requirements whose verifiers reported SCHEMA_VERSION_TOO_NEW" }
      }
    },
    "requirements": {
      "type": "array",
      "items": { "$ref": "#/$defs/requirementTrace" }
    }
  },
  "$defs": {
    "requirementTrace": {
      "type": "object",
      "required": ["requirementId", "level", "acceptanceIds", "tests", "result"],
      "properties": {
        "requirementId": { "type": "string", "pattern": "^V16-[A-Z0-9-]+$" },
        "level": { "enum": ["MUST", "SHOULD", "FUTURE"] },
        "prdSection": { "type": "string", "description": "e.g. '8.2' or '12.3'" },
        "title": { "type": "string" },
        "acceptanceIds": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["acceptanceId", "layer", "testId", "evidenceRef", "result"],
            "properties": {
              "acceptanceId": { "type": "string", "pattern": "^AC-[A-Z0-9-]+$" },
              "layer": { "enum": ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"] },
              "testId": { "type": "string", "pattern": "^V16-T-[A-Z0-9_-]+$" },
              "evidenceRef": { "type": "string", "description": "Relative path to the consumed evidence file" },
              "result": { "enum": ["PASS", "FAIL", "PENDING", "BLOCKED"] },
              "resultDetail": { "type": "string" }
            }
          }
        },
        "result": { "enum": ["PASS", "FAIL", "PENDING", "BLOCKED"] },
        "resultDetail": { "type": "string" }
      }
    }
  }
}
```

### 5.4 MUST closure rule

A MUST is `closed` only if:
- every AC it cites has at least one associated testId in the manifest,
- for each such testId there exists a current evidence file whose `consumedInputs[].sha256` matches the identity binding,
- and every such evidence file has `result = PASS` AND the underlying AC `result = PASS`.

If any cited AC lacks a `testId` in the manifest, the verifier MUST report `BLOCKED` with code `MISSING_TEST_BINDING`.

If the producer/verifier has not yet been wired, the verifier MUST report `PENDING` with code `TEST_NOT_WIRED`.

### 5.5 Legacy artifact isolation (per PRD V16-ACC-010, V16-ACC-015)

The trace closure verifier MUST reject any evidence whose `identity.sourceRevision` differs from the manifest's `identity.sourceRevision` by more than the tolerance declared in the manifest (`maxSourceRevisionDrift`, default `0`). v1.5.1 and `s7` evidence files must be physically excluded from `output/v16-evidence/` (they live in `output/codex-evidence/` and are never copied).

Concretely: the verifier, when scanning `output/v16-evidence/`, MUST ignore any path containing `codex-evidence/`. The aggregator MUST NOT consume `codex-evidence/*.json` files.

---

## 6. Producer / verifier catalog (M0-M2 active buckets)

This catalog enumerates the producer/verifier pairs that MUST be wired before claiming M0 closure. **Gated buckets are listed for completeness but their scripts are not required to exist under user ban.**

### 6.1 L1 单元与合同

| bucketId | producer script | verifier script | evidenceKind | gating |
|---|---|---|---|---|
| `L1-domain-invariants` | `pnpm --filter @amazon-ai-ops/desktop test --run --reporter=basic` (focused suites in §6.1.1) | `scripts/verify-v16-l1-unit-contract.js` | `l1-unit-contract` | active |
| `L1-repo-contracts` | `pnpm --filter @amazon-ai-ops/local-db test --run` | `scripts/verify-v16-l1-repo-contracts.js` | `l1-unit-contract` | active |
| `L1-ai-adapter-contracts` | `pnpm --filter @amazon-ai-ops/ai-adapter test --run` | `scripts/verify-v16-l1-ai-contracts.js` | `l1-unit-contract` | active |
| `L1-shared-types` | `pnpm --filter @amazon-ai-ops/shared-types test --run` | `scripts/verify-v16-l1-shared-types.js` | `l1-unit-contract` | active |
| `L1-preload-typed` | `pnpm --filter @amazon-ai-ops/desktop test --run apps/desktop/src/preload` | `scripts/verify-v16-l1-preload-typed.js` | `l1-unit-contract` | active |

#### §6.1.1 L1 focused suite baseline

The focused suites are inherited from v1.5.1's "157/157 authority tests" baseline. v1.6.0 MUST add at minimum:

| Domain | existing v1.5.1 focused suite | v1.6.0 delta requirement |
|---|---|---|
| 分析运行 authority | `apps/desktop/src/main/analysis-authority-service.test.ts` | + reused-vs-new run receipt assertions (V16-ANA-003, V16-ANA-004) |
| 执行 authority | `apps/desktop/src/main/execution-authority-service.test.ts` | + slot residual state machine tests (V16-GRANT-006) |
| Mission domain | `apps/desktop/src/main/mission-domain-service.test.ts` | + lifecycle archive/restore tests (V16-MIS-004) |
| 正式数据门 | `apps/desktop/src/main/formal-business-data-gate.test.ts` | + template-compatibility-manifest unknown/ambiguous rejection tests (V16-DATA-010) |
| Lingxing 采集 | `apps/desktop/src/main/lingxing-collection-coordinator.test.ts` | + store-switch stale-task rejection tests (V16-DATA-007) |
| AI 策略诊断 | `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts` | + A0-A3 value-tier recording tests (V16-AI-004) |
| OpenAI-compatible provider | `packages/ai-adapter/src/openai-compatible.test.ts` | + cost=`unknown` not zero tests (V16-AI-005) |
| action reason | `packages/ai-adapter/src/ad-action-reason.test.ts` | + reason-non-empty rejection tests (V16-DEC-002) |

The numeric baseline "157/157" is a **historical credit** and is NOT carried into v1.6.0. The new v1.6.0 L1 suite MUST be re-counted from the new focused suite file list and reported as e.g. `current: NNN/NNN`.

### 6.2 L2 静态工程

| bucketId | producer script | verifier script | evidenceKind | gating |
|---|---|---|---|---|
| `L2-typecheck` | `pnpm --filter @amazon-ai-ops/desktop run typecheck` | `scripts/verify-v16-l2-static.js` | `l2-static-engineering` | active |
| `L2-renderer-build` | `pnpm --filter @amazon-ai-ops/desktop run build:renderer` | `scripts/verify-v16-l2-static.js` | `l2-static-engineering` | active |
| `L2-package-scripts` | `node scripts/package-scripts.test.mjs` | `scripts/verify-v16-l2-static.js` | `l2-static-engineering` | active |

### 6.3 L3 业务集成 (dev-environment only)

| bucketId | producer script | verifier script | evidenceKind | gating |
|---|---|---|---|---|
| `L3-business-ui-dev` | `node scripts/smoke-current-business-ui.js` | `scripts/verify-v16-l3-business-dev.js` | `l3-business-integration-dev` | active (dev UI smoke, NOT Package UI) |
| `L3-readiness-aggregation-dev` | `node scripts/verify-mission-control-production-readiness.js` (re-targeted to v1.6.0) | `scripts/verify-v16-l3-business-dev.js` | `l3-business-integration-dev` | active |

### 6.4 Gated buckets (L4–L7)

| bucketId | producer script (NOT TO BE WIRED TODAY) | verifier script (NOT TO BE WIRED TODAY) | evidenceKind | gating |
|---|---|---|---|---|
| `L4-package-ui` | `pnpm run evidence:package-ui` | `scripts/verify-v16-l4-package-ui.js` | `l4-package-ui` | gated |
| `L5-package-security` | `pnpm run smoke:package-launch`, `pnpm run smoke:package-security-boundaries`, `pnpm run smoke:package-adversarial-node-env` | `scripts/verify-v16-l5-package-security.js` | `l5-package-security` | gated |
| `L6-formal-db` | `node scripts/export-mission-control-authority-snapshot.js` | `scripts/verify-v16-l6-formal-db.js` | `l6-formal-db` | gated |
| `L7-canary-manual` | `node scripts/export-mission-control-execution-canary-evidence.js` (manual) | `scripts/verify-v16-l7-canary.js` | `l7-canary` | gated |
| `L7-canary-policy-auto` | (same script, policy-auto flag) | `scripts/verify-v16-l7-canary.js` | `l7-canary` | gated |

### 6.5 L8 readiness aggregation

| bucketId | producer script | verifier script | evidenceKind | gating |
|---|---|---|---|---|
| `L8-readiness-aggregation` | `node scripts/aggregate-v16-readiness.js` | `scripts/verify-v16-l8-readiness-aggregation.js` | `l8-readiness-aggregation` | active (aggregator runs, always reports `APP_NEEDS_WORK` while L4–L7 gated) |

The aggregator MUST implement PRD §21.6 state invariants:

```
READINESS_PASS = (closed == total)
                 AND (pending == 0)
                 AND (failed == 0)
                 AND (summary.blocked == 0)
                 AND publicationClosure verified

APP_READY = READINESS_PASS
            AND README DELIVERY == APP_READY
            AND matching READY bundle safety PASS

otherwise = APP_NEEDS_WORK / INTERNAL NON_READY
```

---

## 7. Publication closure

### 7.1 What publication closure means

A publication closure is the binding between five identity inputs:

1. source revision (`identity.sourceRevision`)
2. package hashes (`identity.packageSha256`)
3. DB snapshot identity (`identity.dbIdentity`)
4. evidence set (files under `output/v16-evidence/`)
5. README DELIVERY line + matching READY/NON_READY bundle

When any of these five inputs change, the publication closure MUST be regenerated. A new closure invalidates the previous `APP_READY` claim per PRD V16-ACC-017.

### 7.2 Verifier

```
scripts/verify-v16-publication-closure.js
```

Inputs:
- `manifest.identity`
- `output/v16-evidence/*.json` (manifest SHA-256 list)
- `README.md` top DELIVERY line
- matching bundle `output/v16-delivery-bundle-*/manifest.json` (if produced)

Output: `output/v16-evidence/v16_publication_closure.json`

### 7.3 Immutability rule

The aggregator MUST refuse to mark `APP_READY` if the closure's `producedAt` is older than any `consumedInputs.producedAt` for an evidence file that the closure consumed. Re-run the closure after any evidence change.

---

## 8. Required PNPM scripts (M0 exit criteria)

The following PNPM scripts MUST exist and exit 0 with the corresponding evidence file before M0 closes. Gated bucket scripts are listed for forward planning but are NOT required under user ban.

```jsonc
{
  "verify:v16-required-test-manifest": "node scripts/verify-v16-required-test-manifest.js",
  "verify:v16-trace-closure": "node scripts/verify-v16-trace-closure.js",
  "verify:v16-l1-unit-contract": "node scripts/verify-v16-l1-unit-contract.js",
  "verify:v16-l1-repo-contracts": "node scripts/verify-v16-l1-repo-contracts.js",
  "verify:v16-l1-ai-contracts": "node scripts/verify-v16-l1-ai-contracts.js",
  "verify:v16-l1-shared-types": "node scripts/verify-v16-l1-shared-types.js",
  "verify:v16-l1-preload-typed": "node scripts/verify-v16-l1-preload-typed.js",
  "verify:v16-l2-static": "node scripts/verify-v16-l2-static.js",
  "verify:v16-l3-business-dev": "node scripts/verify-v16-l3-business-dev.js",
  "aggregate:v16-readiness": "node scripts/aggregate-v16-readiness.js",
  "verify:v16-l8-readiness-aggregation": "node scripts/verify-v16-l8-readiness-aggregation.js",
  "verify:v16-publication-closure": "node scripts/verify-v16-publication-closure.js",
  // GATED — exist as stubs only, return PENDING
  "verify:v16-l4-package-ui": "node scripts/verify-v16-l4-package-ui.js",
  "verify:v16-l5-package-security": "node scripts/verify-v16-l5-package-security.js",
  "verify:v16-l6-formal-db": "node scripts/verify-v16-l6-formal-db.js",
  "verify:v16-l7-canary": "node scripts/verify-v16-l7-canary.js"
}
```

---

## 9. Companion spec exit criteria (this draft)

This 0.1 draft exits "Propose → Active" when:

- [ ] The required-test manifest JSON Schema in §3.3 is checked into `docs/v16_required_test_manifest.schema.json`.
- [ ] The evidence record JSON Schema in §4.2 is checked into `docs/v16_evidence.schema.json`.
- [ ] The trace closure JSON Schema in §5.3 is checked into `docs/v16_trace_closure.schema.json`.
- [ ] `scripts/verify-v16-required-test-manifest.js` exists and validates a sample manifest.
- [ ] `scripts/verify-v16-required-test-manifest.test.mjs` passes in vitest.
- [ ] `scripts/verify-v16-trace-closure.js` exists with a working parser for the PRD requirement tables.
- [ ] `scripts/verify-v16-trace-closure.test.mjs` passes in vitest.
- [ ] All M0-required bucket entries from §6.1–§6.3 are present in the manifest.
- [ ] The legacy isolation rule in §5.5 is implemented in both verifiers and tested.

---

## 10. Open questions deferred to next version (0.2)

1. **Naming convention**: v1.5.1 uses `verify:v15-*` and `verify:s7-*`. v1.6.0 may want a single namespace `verify:v16-*` (proposed) or keep two. PRD V16-ACC-010 mentions "legacy v15/s7 命名工具只有通过 v1.6 schema/identity adapter 和当前验证后才能参与流程"; the adapter spec is deferred.
2. **NFR Baseline/Budget binding**: PRD §19.6 introduces Baseline/Budget records but no concrete format. Drafting it is part of the **Release & Canary** companion spec, not this one.
3. **AI Spend Policy**: PRD §17.5 mentions it; its evidence record format is deferred to a follow-up.
4. **Accessibility Delta Register**: PRD §18.7 requires it; its evidence record format is deferred.
5. **Required-test manifest for L4–L7**: this draft leaves their `tests` array empty (`[]`). L4–L7 entries are populated by the gated-bucket stub once the **Release & Canary** companion spec defines them.
6. **Two-store × seven-day evidence**: PRD AC-ACC-008. Format deferred to **Release & Canary** companion spec.

---

## 11. References

- PRD: `docs/amazon_ai_ops_agent_prd_v1_6_0.md` v1.1
- v1.5.1 verifier convention: `scripts/verify-v15-*.js` + `scripts/verify-v15-*.test.mjs`
- v1.5.1 evidence folder: `output/codex-evidence/` (explicitly excluded from v1.6.0 inputs)
- Related companion specs (not yet drafted):
  - `docs/v16_companion_migration_compatibility.md`
  - `docs/v16_companion_release_canary.md`
