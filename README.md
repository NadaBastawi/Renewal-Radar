# Renewal-Radar

Renewal Radar is a lightweight Next.js dashboard for reconciling Harbourline billing exports and project exports when the files do not share a stable client ID. It combines fuzzy client-name matching, review-based safeguards, and a simple 45-day renewal view so account leads can quickly see which clients are due soon, lapsed, or need follow-up.

Live app: https://renewal-radar-eosin.vercel.app

## What the tool does

- Reads a billing export and a project export
- Normalizes messy client names and matches likely equivalents across both files
- Flags duplicates, missing renewal dates, and unmatched project records for review
- Groups matched retainers into clear states such as due soon, lapsed, and not yet due
- Presents a clean dashboard for account leads without requiring a shared ID field

## Local development

1. Install dependencies:
   npm install

2. Start the app locally:
   npm run dev

3. Open the app in your browser at:
   http://localhost:3000

## Running tests

npm test

## Sample data and handling of messy-data problems

The sample data is intentionally imperfect and lives in:

- sample-data/billing-export.csv
- sample-data/project-export.csv

These are used directly by the app and the automated tests to exercise the real-world data issues that Harbourline has to manage.

### 1) Name variants and spelling differences

The project and billing exports use different naming conventions for the same business, including legal suffixes, capitalization, punctuation, and spacing differences. The matching logic in lib/matching.js handles this through normalizeClientName() and findBestClientMatch().

Examples from the sample exports include:

- Bright Wave Media vs BRIGHTWAVE MEDIA LLC
- Northstar Labs Inc vs North Star Labs, Inc
- Harbor & Pine Studio vs Harbour and Pine Studio

The logic normalizes names before fuzzy matching, so close variants are matched while genuinely unrelated names remain visible for review.

Word-level fuzzy matching cannot perfectly separate every true name variant from every distinct-but-similar company name. In testing, 'Marlow Advisory' versus the unrelated 'Marlowe Advisory Group' scored closer to a match than some genuine spelling variants did. The chosen threshold therefore favors fewer false merges over catching every variant, which means a small number of legitimate variants may land in the unmatched/needs-review queue instead of auto-matching. That is treated as the safer failure mode because the human reviewer still sees the row instead of risking a wrong merge. See the comment above MATCH_THRESHOLD in lib/matching.js for the full rationale.

### 2) Missing renewal dates

Some billing rows are incomplete and do not have a renewal date on file. Instead of guessing a date and creating false urgency, the engine flags those rows as missing_renewal_date and keeps them in a review queue. This is handled in reconcileClientExports() in lib/matching.js, where an empty or missing renewal date triggers reviewRequired and a reason instead of an invented renewal window.

The sample export includes the Crestline Health Co. case as a clear example of a missing renewal date that should not be silently filled in.

### 3) Duplicate billing rows

The billing export contains both current and stale entries for the same client. resolveDuplicateBillingRows() collapses those records down to the newest relevant contract period, which prevents double counting while preserving the older record for audit context when needed. This is especially important for the Ashcroft Retail Group re-signing case in the sample data.

### 4) No shared ID across exports

There is no single customer ID shared by the billing and project files, so the tool cannot rely on exact joins. Instead, it uses normalized fuzzy matching plus a conservative threshold. Records that do not match strongly enough remain visible as unmatched rows or billing-only records so account leads can review them rather than missing them entirely.

This is implemented in lib/matching.js via the client-name matching flow and the reconciliation result structure, which separates:

- matched rows
- billing-only records
- unmatched project rows
- missing renewal date review cases

## Notes on the review model

The dashboard deliberately keeps ambiguous or incomplete information visible for human review rather than silently forcing a match. This is safer for an account lead workflow because a false positive match is worse than a genuine review item.

For the sample data, the app distinguishes between:

- due soon or lapsed renewals
- not yet due retainers
- date-missing records requiring review
- billing-only records with real dates but no project export match
- unmatched project rows with no client match at all

This helps the user judge urgency at a glance without conflating different operational problems into one opaque number.
