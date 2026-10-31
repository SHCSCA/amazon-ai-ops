# Owner-confirmed family observation (read-only)

`observeOwnerConfirmedFamily` is an exported report-parser helper, not an application scope confirmation, import, persistent grant, advertised-product ledger, or formal AI/Ads eligibility path.

## Inputs and provenance

The caller must obtain an actual owner statement covering the selected family and specific report files/window. Supply `OwnerConfirmedFamilyScope` v1 with `provenanceLabel: user_confirmed_scope`, a confirmation reference, store/site, bounded dates and exact SHA-256/type/window file bindings. Neither a typed structure nor its reference authenticates the statement; The optional desktop session adapter now captures an explicit exact-bundle confirmation (see `FAMILY_OBSERVATION_DESKTOP.md`); persisted confirmation and audit signing remain unimplemented. Never manufacture confirmation from campaign names, filenames, current scope text, or a prior confirmation covering different bytes.

Supply raw `Uint8Array` workbook bytes and report level. The helper copies each byte snapshot, calculates SHA-256, requires its exact binding, then parses that same snapshot with the production registered-template parser. It does not accept caller-supplied parsed rows or their claimed hashes. One file per advertising level is supported; overlapping same-level files require separate explicit resolution. Auxiliary bindings can be retained but auxiliary content is not parsed or reconciled here. The function performs no filesystem writes, database access, network calls, or authorization changes.

The existing `ReportParser.parseExcel` now delegates to `parseExcelBytes`; the parsing policy is unchanged. The new byte entrypoint also permits other read-only consumers to bind a parser result to the bytes they hash.

## Observation semantics

- Campaign is the only selected family advertising level. Ad-group is a separate cross-check; keyword is a subset with unknown coverage. There is no grand total adding report levels.
- All dates in the bounded confirmation window are represented. Absent daily rows are `null` (unknown), never inferred zero. An explicit valid source zero remains zero.
- Source metric masks, finite nonnegative values, integer count validity and safe aggregate bounds are required independently per metric. Unknown or invalid source values yield `null` for that metric.
- Repeated parsed dimensions within a level/date are ambiguous without native IDs. Their aggregate metrics become `null`; physical source-row references remain intact. Rows are not silently deduplicated. Unique label rows remain only label-identified observations, not proven object identity.
- `campaignMinusAdGroup` preserves numerical differences. A nonzero known difference yields `discrepancy`, complete agreement yields `match`, otherwise `unknown`. Only floating-point tails below `1e-8` are ignored for the classification; original delta values are returned. No cause is guessed.
- Output is always `partial-observation`, with unknown currency/attribution and keyword coverage, `nativeAsinAuthority: false`, and `formalEligibility: false`. Parser currency defaults do not establish independently verified monetary semantics.
- No ASIN allocation, combined sales/ads profit, organic sales, complete-period coverage or financial certification is inferred. Registered templates do not prove source report exhaustiveness; uniquely labeled totals/subtotals cannot always be distinguished from business rows. The output is not a certified ledger.

## Integration boundary

Current operation scope persists dates, store/site, ASIN, batch and currency; it has no owner-confirmed family/exact-file binding or provenance capture. The optional desktop session adapter is explicitly invoked and keeps its exact confirmation bundle separate from saved scope, import permissions, AI context and grants. Observation labels remain distinct from native source authority. Future files cannot inherit this scope automatically.

Only synthetic workbooks belong in repository tests. Actual user-file hashes, names, financial values and row-level outputs must remain in private local validation evidence, outside repository patches and public fixtures.

## Resource limits

At most 32 confirmation bindings, three advertising files, 32 MiB per input workbook, 366 inclusive dates, and 100,000 parsed rows per file are supported. Daily grouping uses linear append. The row cap applies after workbook parsing; neither this cap nor compressed byte size bounds XLSX decompression memory. This helper does not claim zip-bomb safety. Callers handling untrusted large workbooks need a separately sandboxed parser/resource boundary.
