'use client';

import { useEffect, useMemo, useState } from 'react';

const defaultSummary = {
  matched: 0,
  orphanBilling: 0,
  unmatchedProjects: 0,
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
}

function clusterRows(data) {
  const matchedRows = Array.isArray(data?.matchedRows) ? data.matchedRows : [];
  const orphanBillingRows = Array.isArray(data?.orphanBillingRows) ? data.orphanBillingRows : [];
  const unmatchedProjects = Array.isArray(data?.unmatchedProjects) ? data.unmatchedProjects : [];

  return {
    dueSoon: matchedRows.filter((row) => row.renewalWindow === 'due_soon'),
    lapsed: matchedRows.filter((row) => row.renewalWindow === 'lapsed'),
    notYetDue: matchedRows.filter((row) => row.renewalWindow === 'not_yet_due'),
    review: [
      ...matchedRows.filter((row) => row.reviewRequired),
      ...orphanBillingRows,
      ...unmatchedProjects,
    ],
  };
}

export default function Home() {
  const [result, setResult] = useState({
    matchedRows: [],
    orphanBillingRows: [],
    unmatchedProjects: [],
    summary: defaultSummary,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState('sample');
  const [billingFileName, setBillingFileName] = useState('');
  const [projectFileName, setProjectFileName] = useState('');

  const fetchReconciliation = async (body) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/reconcile', {
        method: body ? 'POST' : 'GET',
        headers: body ? { Accept: 'application/json' } : undefined,
        body: body ? body : undefined,
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Unable to reconcile exports.');
      }

      const data = await response.json();
      setResult(data);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load reconciliation results.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReconciliation();
  }, []);

  const grouped = useMemo(() => clusterRows(result), [result]);

  const summaryCards = [
    {
      label: 'Due soon',
      value: grouped.dueSoon.length,
      accent: 'blue',
    },
    {
      label: 'Lapsed',
      value: grouped.lapsed.length,
      accent: 'red',
    },
    {
      label: 'Needs review',
      value: grouped.review.length,
      accent: 'amber',
    },
  ];

  const handleUpload = async (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const billingInput = formData.get('billingCsv');
    const projectInput = formData.get('projectCsv');

    if (!billingInput || !projectInput) {
      setError('Please upload both billing and project CSV exports.');
      return;
    }

    setSource('uploaded');
    setBillingFileName(billingInput.name || 'billing-export.csv');
    setProjectFileName(projectInput.name || 'project-export.csv');
    await fetchReconciliation(formData);
  };

  const renderTable = (title, rows, emptyText) => (
    <section className="panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <span>{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <p className="empty-state">{emptyText}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Project</th>
                <th>Renewal date</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.client_name || row.billing_client_name || 'row'}-${index}`}>
                  <td>{row.billing_client_name || row.client_name}</td>
                  <td>{row.project_name || 'Billing-only record'}</td>
                  <td>{formatDate(row.renewal_date || row.billing_row?.renewal_date)}</td>
                  <td>
                    <span className={`pill ${row.renewalWindow || row.matchStatus || 'review'}`}>
                      {row.renewalWindow || row.matchStatus || 'review'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Harbourline retainers</p>
          <h1>Renewal Radar</h1>
        </div>
        <div className="topbar-actions">
          <button className="secondary" type="button" onClick={() => fetchReconciliation()}>
            Use sample data
          </button>
        </div>
      </header>

      <section className="summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className={`summary-card ${card.accent}`}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="controls panel">
        <div>
          <h3>Data source</h3>
          <p>{source === 'sample' ? 'Using built-in Harbourline sample exports.' : 'Using uploaded CSV files.'}</p>
        </div>
        <form className="upload-form" onSubmit={handleUpload}>
          <label>
            Billing CSV
            <input type="file" name="billingCsv" accept=".csv" />
          </label>
          <label>
            Project CSV
            <input type="file" name="projectCsv" accept=".csv" />
          </label>
          <button type="submit">Reconcile uploads</button>
        </form>
      </section>

      {billingFileName || projectFileName ? (
        <div className="file-meta">
          {billingFileName && <span>Billing: {billingFileName}</span>}
          {projectFileName && <span>Project: {projectFileName}</span>}
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="loading-state">Loading renewal data…</div> : null}

      {!loading && !error ? (
        <>
          <div className="columns">
            {renderTable('Due soon', grouped.dueSoon, 'No retainers are due in the next 45 days.')}
            {renderTable('Lapsed', grouped.lapsed, 'No lapsed renewals right now.')}
            {renderTable('Not yet due', grouped.notYetDue, 'Nothing due after the 45-day window.')}
          </div>

          {renderTable('Needs review', grouped.review, 'No accounts require review.')}
        </>
      ) : null}
    </main>
  );
}
