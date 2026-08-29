import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { reconcileClientExports } from '../../../lib/matching.js';

const REQUIRED_BILLING_COLUMNS = ['client_name', 'contract_start', 'renewal_date', 'monthly_fee', 'status'];
const REQUIRED_PROJECT_COLUMNS = ['client_name', 'project_name', 'project_scope', 'project_end', 'status'];

function parseCsvText(csvText) {
  if (!csvText || !String(csvText).trim()) {
    return [];
  }

  const result = Papa.parse(String(csvText), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => String(header || '').trim(),
  });

  if (result.errors && result.errors.length > 0) {
    throw new Error('CSV parsing error');
  }

  return result.data;
}

function validateColumns(rows, requiredColumns, label) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${label} file could not be read — please check the file format and required columns.`);
  }

  const headers = Object.keys(rows[0] || {});
  const missingColumns = requiredColumns.filter((column) => !headers.includes(column));

  if (missingColumns.length > 0) {
    throw new Error(`${label} file could not be read — please check the file format and required columns.`);
  }
}

function readSampleCsv(filename) {
  const csvPath = path.join(process.cwd(), 'sample-data', filename);
  return fs.readFileSync(csvPath, 'utf8');
}

async function coerceToCsvText(input) {
  if (!input) {
    return '';
  }

  if (typeof input === 'string') {
    return input;
  }

  if (typeof input.text === 'function') {
    return await input.text();
  }

  if (typeof input.arrayBuffer === 'function') {
    const buffer = await input.arrayBuffer();
    return Buffer.from(buffer).toString('utf8');
  }

  return String(input);
}

export async function GET() {
  const billingCsv = readSampleCsv('billing-export.csv');
  const projectCsv = readSampleCsv('project-export.csv');

  const result = reconcileClientExports({
    billingRows: parseCsvText(billingCsv),
    projectRows: parseCsvText(projectCsv),
    referenceDate: new Date(),
  });

  return Response.json(result);
}

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let billingCsv = '';
    let projectCsv = '';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      billingCsv = body.billingCsv || body.billing_export || '';
      projectCsv = body.projectCsv || body.project_export || '';
    } else {
      const formData = await request.formData();
      const billingFile = formData.get('billingCsv') || formData.get('billing') || formData.get('billingFile');
      const projectFile = formData.get('projectCsv') || formData.get('project') || formData.get('projectFile');

      billingCsv = await coerceToCsvText(billingFile);
      projectCsv = await coerceToCsvText(projectFile);

      const billingName = typeof billingFile?.name === 'string' ? billingFile.name.toLowerCase() : '';
      const projectName = typeof projectFile?.name === 'string' ? projectFile.name.toLowerCase() : '';

      if (billingName && !billingName.endsWith('.csv')) {
        throw new Error('The Billing CSV file could not be read — please check the file format and required columns.');
      }

      if (projectName && !projectName.endsWith('.csv')) {
        throw new Error('The Project CSV file could not be read — please check the file format and required columns.');
      }
    }

    if (!billingCsv || !projectCsv) {
      return Response.json(
        {
          error: 'Both CSV files are required to reconcile the account data.',
        },
        { status: 400 },
      );
    }

    let billingRows;
    let projectRows;

    try {
      billingRows = parseCsvText(billingCsv);
      validateColumns(billingRows, REQUIRED_BILLING_COLUMNS, 'Billing');
    } catch (error) {
      return Response.json(
        {
          error: 'The Billing CSV file could not be read — please check the file format and required columns.',
        },
        { status: 400 },
      );
    }

    try {
      projectRows = parseCsvText(projectCsv);
      validateColumns(projectRows, REQUIRED_PROJECT_COLUMNS, 'Project');
    } catch (error) {
      return Response.json(
        {
          error: 'The Project CSV file could not be read — please check the file format and required columns.',
        },
        { status: 400 },
      );
    }

    const result = reconcileClientExports({
      billingRows,
      projectRows,
      referenceDate: new Date(),
    });

    return Response.json(result);
  } catch (error) {
    const message = error?.message || 'Unable to reconcile exports.';

    if (message.includes('could not be read') || message.includes('Both CSV files are required')) {
      return Response.json(
        {
          error: message,
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        error: 'Unable to reconcile exports.',
        details: message,
      },
      { status: 500 },
    );
  }
}
