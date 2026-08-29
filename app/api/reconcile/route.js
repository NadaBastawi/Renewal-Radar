import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import matching from '../../../lib/matching.js';

const { reconcileClientExports } = matching;

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
    return result.data;
  }

  return result.data;
}

function readSampleCsv(filename) {
  const csvPath = path.join(process.cwd(), 'sample-data', filename);
  return fs.readFileSync(csvPath, 'utf8');
}

function coerceToCsvText(input) {
  if (!input) {
    return '';
  }

  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof File) {
    return input.text ? input.text() : '';
  }

  if (typeof input.text === 'function') {
    return input.text();
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
    }

    if (!billingCsv || !projectCsv) {
      return Response.json(
        {
          error: 'Both billingCsv and projectCsv are required.',
        },
        { status: 400 },
      );
    }

    const result = reconcileClientExports({
      billingRows: parseCsvText(billingCsv),
      projectRows: parseCsvText(projectCsv),
      referenceDate: new Date(),
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: 'Unable to reconcile exports.',
        details: error.message,
      },
      { status: 500 },
    );
  }
}
