const Fuse = require('fuse.js');

const LEGAL_SUFFIXES = [
  'llc',
  'ltd',
  'limited',
  'inc',
  'co',
  'corp',
  'corporation',
  'company',
  'partners',
  'group',
];

// We keep the fuzzy threshold intentionally conservative, but we do not pretend there is a clean
// word-level separator that distinguishes every true variant from every distinct-but-similar company name.
// In the real sample data, the margin is very small: Northstar Labs Inc vs North Star Labs, Inc is about
// 0.2181, while a different but unrelated company name like Marlow Advisory vs Marlowe Advisory Group is
// 0.1474, which is actually lower and therefore closer to matching. That means 0.22 is not perfect; some
// genuine spelling variants may sit just above or just below the cutoff and fall into the 'unmatched — needs
// review' bucket instead of auto-merging. That is the safer failure mode for an account lead workflow: it
// keeps the ambiguous record visible for human review rather than silently risking a false merge between two
// distinct businesses. Perfect separation is not possible with fuzzy, word-level matching alone, and this is
// why low-confidence rows are surfaced for review rather than hidden.
const MATCH_THRESHOLD = 0.22;

function normalizeClientName(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(new RegExp(`\\b(?:${LEGAL_SUFFIXES.join('|')})\\b`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const parsed = new Date(String(value).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getRenewalWindowState(renewalDate, referenceDate = new Date()) {
  const parsedDate = parseDate(renewalDate);

  if (!parsedDate) {
    return 'needs_review';
  }

  const diffDays = Math.ceil((parsedDate - new Date(referenceDate)) / 86400000);

  if (diffDays < 0) {
    return 'lapsed';
  }

  if (diffDays <= 45) {
    return 'due_soon';
  }

  return 'not_yet_due';
}

function findBestClientMatch(targetName, candidateRows, threshold = MATCH_THRESHOLD) {
  const target = normalizeClientName(targetName);

  if (!target) {
    return null;
  }

  const normalizedCandidates = candidateRows.map((row, index) => ({
    ...row,
    normalizedName: normalizeClientName(row.client_name),
    index,
  }));

  const exactMatch = normalizedCandidates.find(
    (candidate) => candidate.normalizedName === target,
  );

  if (exactMatch) {
    return exactMatch;
  }

  const fuse = new Fuse(normalizedCandidates, {
    keys: ['normalizedName'],
    threshold,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 3,
  });

  const result = fuse.search(target)[0];
  return result ? result.item : null;
}

function resolveDuplicateBillingRows(rows = []) {
  const groups = new Map();

  rows.forEach((row) => {
    const key = normalizeClientName(row.client_name);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  });

  const deduped = [];

  groups.forEach((group) => {
    if (group.length === 1) {
      deduped.push(group[0]);
      return;
    }

    // Duplicate billing rows are resolved by keeping the newest contract period, not the first or biggest
    // deal. In re-signing situations, the newest renewal date is the clearest signal that the account is
    // active under the most recent retainer, while older rows remain visible for audit but are not treated
    // as current opportunities. This is a deliberate tradeoff: it prevents double counting without inventing
    // a new identity when the client name is identical across multiple contract periods.
    const latest = [...group].sort((a, b) => {
      const aDate = parseDate(a.renewal_date) || parseDate(a.contract_start) || new Date(0);
      const bDate = parseDate(b.renewal_date) || parseDate(b.contract_start) || new Date(0);
      return bDate - aDate;
    })[0];

    deduped.push({
      ...latest,
      duplicateResolved: true,
      duplicateDropped: group.filter((row) => row !== latest),
    });
  });

  return deduped;
}

function reconcileClientExports({
  billingRows = [],
  projectRows = [],
  referenceDate = new Date(),
  threshold = MATCH_THRESHOLD,
}) {
  const dedupedBillingRows = resolveDuplicateBillingRows(billingRows);
  const usedBillingIds = new Set();
  const matchedRows = [];
  const orphanBillingRows = [];
  const unmatchedProjects = [];

  projectRows.forEach((projectRow) => {
    const match = findBestClientMatch(projectRow.client_name, dedupedBillingRows, threshold);

    if (!match) {
      // We keep unmatched project rows visible with a review flag instead of silently dropping them. In a
      // manual account-review workflow, a missing match is a meaningful signal that the export may contain a
      // new client, a naming issue, or a stale project; hiding it would be more dangerous than flagging it.
      unmatchedProjects.push({
        ...projectRow,
        matchStatus: 'unmatched',
        reviewRequired: true,
        reasons: ['No client name match above the threshold.'],
      });
      return;
    }

    const billingRow = { ...match };
    const billingKey = `${billingRow.client_name}:${billingRow.contract_start}:${billingRow.renewal_date}`;
    usedBillingIds.add(billingKey);

    // Missing renewal values are surfaced as human-review items rather than guessed. An empty date often
    // means the export is incomplete, and trying to infer one would quietly create false urgency; the safer
    // behavior is to flag the record and let the account lead verify it. This sacrifices automation on a few
    // incomplete rows in exchange for keeping the renewal list honest.
    const missingRenewalDate = !billingRow.renewal_date || String(billingRow.renewal_date).trim() === '';

    matchedRows.push({
      ...projectRow,
      billing_client_name: billingRow.client_name,
      billing_row: billingRow,
      matchStatus: missingRenewalDate ? 'missing_renewal_date' : 'matched',
      reviewRequired: missingRenewalDate,
      renewalWindow: getRenewalWindowState(billingRow.renewal_date, referenceDate),
      reasons: missingRenewalDate ? ['Missing renewal date; left for human review instead of guessed.'] : [],
      confidence: match.normalizedName === normalizeClientName(projectRow.client_name) ? 1 : 1 - (match?.score || 0),
    });
  });

  dedupedBillingRows.forEach((billingRow) => {
    const billingKey = `${billingRow.client_name}:${billingRow.contract_start}:${billingRow.renewal_date}`;

    if (!usedBillingIds.has(billingKey)) {
      orphanBillingRows.push({
        ...billingRow,
        matchStatus: 'billing_only',
        reviewRequired: true,
        reasons: ['Present in billing but absent from project scope export.'],
      });
    }
  });

  return {
    matchedRows,
    orphanBillingRows,
    unmatchedProjects,
    dedupedBillingRows,
    summary: {
      matched: matchedRows.length,
      orphanBilling: orphanBillingRows.length,
      unmatchedProjects: unmatchedProjects.length,
    },
  };
}

module.exports = {
  LEGAL_SUFFIXES,
  MATCH_THRESHOLD,
  normalizeClientName,
  parseDate,
  getRenewalWindowState,
  findBestClientMatch,
  resolveDuplicateBillingRows,
  reconcileClientExports,
};
