import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { client_id, token } = await req.json();

    if (!client_id || !token) {
      return Response.json({ error: 'Missing client_id or token' }, { status: 400 });
    }

    const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });

    if (!clients || clients.length === 0) {
      return Response.json({ error: 'לא נמצא לקוח — פנה לרואה החשבון שלך' }, { status: 404 });
    }

    const client = clients[0];

    if (client.token && client.token !== token) {
      return Response.json({ error: 'לינק לא תקין — פנה לרואה החשבון שלך' }, { status: 403 });
    }

    const taxYear = client.tax_year || 2024;
    const submissions = await base44.asServiceRole.entities.Submission.filter({ client_id, tax_year: taxYear });
    const submission = submissions?.find(s => !s.is_archived) || null;

    return Response.json({ client, submission });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});