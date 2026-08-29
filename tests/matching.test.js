import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { describe, it, expect } from 'vitest';
import { resolveDuplicateBillingRows, reconcileClientExports, getRenewalWindowState } from '../lib/matching.js';

function loadSampleCsv(filename) {
  const fullPath = path.join(process.cwd(), 'sample-data', filename);
  const csv = fs.readFileSync(fullPath, 'utf8');
  return Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
}

describe('matching logic against sample CSV data', () => {
  it('matches name variants despite spelling, casing, and legal suffix differences', () => {
    const billingRows = loadSampleCsv('billing-export.csv');
    const projectRows = loadSampleCsv('project-export.csv');
    const result = reconcileClientExports({
      billingRows,
      projectRows,
      referenceDate: new Date('2026-08-28'),
    });

    const brightWave = result.matchedRows.find((row) => row.client_name === 'BRIGHTWAVE MEDIA LLC');
    const northstar = result.matchedRows.find((row) => row.client_name === 'North Star Labs, Inc');
    const harborPine = result.matchedRows.find((row) => row.client_name === 'Harbour and Pine Studio');

    expect(brightWave.billing_client_name).toBe('Bright Wave Media');
    expect(northstar.billing_client_name).toBe('Northstar Labs Inc');
    expect(harborPine.billing_client_name).toBe('Harbor & Pine Studio');
  });

  it('flags missing end date without dropping or guessing it', () => {
    const billingRows = loadSampleCsv('billing-export.csv');
    const projectRows = loadSampleCsv('project-export.csv');
    const result = reconcileClientExports({
      billingRows,
      projectRows,
      referenceDate: new Date('2026-08-28'),
    });

    const crestline = result.matchedRows.find((row) => row.client_name === 'Crestline Health Co.');

    expect(crestline).toBeTruthy();
    expect(crestline.reviewRequired).toBe(true);
    expect(crestline.matchStatus).toBe('missing_renewal_date');
    expect(crestline.reasons).toContain('Missing renewal date; left for human review instead of guessed.');
  });

  it('collapses duplicate billing rows to the newest contract period', () => {
    const billingRows = loadSampleCsv('billing-export.csv');
    const deduped = resolveDuplicateBillingRows(billingRows);
    const ashcroft = deduped.filter((row) => row.client_name === 'Ashcroft Retail Group');

    expect(ashcroft).toHaveLength(1);
    expect(ashcroft[0].renewal_date).toBe('2026-11-20');
    expect(ashcroft[0].duplicateResolved).toBe(true);
  });

  it('keeps unmatched rows surfaced for review', () => {
    const billingRows = loadSampleCsv('billing-export.csv');
    const projectRows = loadSampleCsv('project-export.csv');
    const result = reconcileClientExports({
      billingRows,
      projectRows,
      referenceDate: new Date('2026-08-28'),
    });

    expect(result.unmatchedProjects.some((row) => row.client_name === 'Norse Harbor Group')).toBe(true);
    expect(result.unmatchedProjects.some((row) => row.client_name === 'Oak & Ember Partners')).toBe(true);
    expect(result.unmatchedProjects.every((row) => row.reviewRequired)).toBe(true);
  });

  it('surfaces billing-only rows with no project export match for review', () => {
    const billingRows = loadSampleCsv('billing-export.csv');
    const projectRows = loadSampleCsv('project-export.csv');
    const result = reconcileClientExports({
      billingRows,
      projectRows,
      referenceDate: new Date('2026-08-28'),
    });

    const orphanNames = ['Marlow Advisory', 'Larkspur Logistics', 'Beacon Street Ventures'];

    orphanNames.forEach((name) => {
      expect(result.orphanBillingRows.some((row) => row.client_name === name)).toBe(true);
    });

    expect(result.orphanBillingRows.every((row) => row.reviewRequired === true)).toBe(true);
  });

  it('separates due-soon, not-yet-due, and lapsed rows in the 45-day window', () => {
    expect(getRenewalWindowState('2026-08-15', new Date('2026-08-28'))).toBe('lapsed');
    expect(getRenewalWindowState('2026-09-18', new Date('2026-08-28'))).toBe('due_soon');
    expect(getRenewalWindowState('2027-03-03', new Date('2026-08-28'))).toBe('not_yet_due');
    expect(getRenewalWindowState('', new Date('2026-08-28'))).toBe('needs_review');
  });
});
