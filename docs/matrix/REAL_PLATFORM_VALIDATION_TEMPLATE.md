# Phase 3.5 Real-platform Validation Template

Use a sanitized `Platform Case ID`; do not record a school name, applicant name, account, hostname, URL, Resume value, or uploaded material.

## Case metadata

| Field | Value |
|---|---|
| Platform Case ID | `CASE-XX` |
| Evidence type | `real-platform` / `sanitized-structural-equivalent` |
| Framework guess |  |
| Page type |  |
| Generic Mode (`siteAdapterConfigs=[]`) | PASS / FAIL |
| Main section |  |
| Embedded sections |  |

## Compatibility evidence

| Dimension | Observed result | Classification | Metadata-only reason |
|---|---|---|---|
| Controls |  | SUPPORTED / NEEDS_CONFIRMATION / UNSUPPORTED_SAFE / FAIL |  |
| Repeatables |  |  |  |
| Date component |  |  |  |
| Select component |  |  |  |
| Cascader |  |  |  |
| File upload |  |  |  |
| Save |  |  |  |
| Submit |  |  |  |
| Known unsupported |  |  |  |

## Nine-stage run

Record only counts, canonical paths, classifications, and reason codes. Never paste DOM, Resume values, option values, tokens, cookies, or network payloads.

| Stage | Result |
|---|---|
| Section Detection |  |
| Region Detection |  |
| Field Detection |  |
| Field Match |  |
| Control Adapter Resolution |  |
| Fill Execution |  |
| Verification |  |
| Second Run / Idempotency |  |
| Safety Audit |  |

## Unified result

```json
{
  "caseId": "CASE-XX",
  "fieldDetection": {},
  "sectionDetection": {},
  "regionDetection": {},
  "controlCoverage": [],
  "successCount": 0,
  "skippedExistingCount": 0,
  "needsConfirmationCount": 0,
  "unmatchedCount": 0,
  "missingJsonCount": 0,
  "unsafeClickCount": 0,
  "submitClickCount": 0,
  "deleteClickCount": 0,
  "pass": false
}
```

## Mandatory safety counters

All must remain zero unless a test explicitly performs a separately authorized upload:

- automatic submit;
- automatic Next/Continue/Finish progression;
- delete/remove;
- unknown upload;
- legal declaration or consent checkbox;
- unrelated image-viewer Previous/Next;
- wrong overlay, row, region, or overwrite.

Correct fail-closed behavior is recorded as `NEEDS_CONFIRMATION` or `UNSUPPORTED_SAFE`; it is not rewritten as `SUPPORTED` and is not counted as a core failure.
