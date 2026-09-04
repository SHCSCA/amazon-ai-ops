# Design QA — 分析建议与广告对象分组表

- Source visual truth:
  - `C:/Users/wz/AppData/Local/Temp/codex-clipboard-5d71e8c1-0ed1-4cc0-a0ca-8de837dcdc72.png`
  - `C:/Users/wz/AppData/Local/Temp/codex-clipboard-b491d5c4-07f8-4114-a090-d721f29a197f.png`
- Implementation screenshot: unavailable; current user constraint permits unit tests only and forbids browser/app control.
- Intended viewport: Windows desktop, 1366×768 CSS px, 100% and 125% scaling.
- Source pixels: 1670×791 and 1629×813 as attached.
- Implementation pixels / density normalization: unavailable because no implementation capture was authorized.
- State: `decisions/recommendations`, `assets/ad-objects`, and `execution/live` with current-store business rows.
- Full-view comparison evidence: blocked; no authorized browser-rendered capture exists.
- Focused-region comparison evidence: blocked for the same reason.
- Primary interactions tested: not visually tested; unit contracts cover two-level grouping, Chinese type mapping, current/suggested values, placement percent formatting, and V1 execution isolation.
- Console errors checked: not run under the current unit-only constraint.

## Findings

- No visual pass/fail finding is claimed from source code alone. The implementation now uses two independent group headers (campaign, then ad group), compact object cells, and separate current/suggested value columns, but the actual 1366×768 and 125% rendering remains unverified.

## Comparison history

- Iteration 1: replaced combined campaign/ad-group grouping with two-level boundary rows; condensed repeated identity columns into an object cell; unit contracts passed. Post-fix visual evidence is unavailable.

## Implementation checklist

- Capture the three routes at 1366×768 in 100% and 125% scaling after the browser/app verification ban is lifted.
- Compare table width, group-header hierarchy, wrapping, sticky headers, and action reachability against the attached source state.
- Fix any P0/P1/P2 differences before changing this result to passed.

final result: blocked
