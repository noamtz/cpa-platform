import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { client_id, token, data, completed } = body;
    let submissionId = body.submission_id || null;

    if (!client_id || !token) {
      return Response.json({ error: 'Missing client_id or token' }, { status: 400 });
    }

    // Verify token and get client
    const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });
    if (!clients || clients.length === 0) {
      return Response.json({ error: 'Client not found' }, { status: 404 });
    }
    const client = clients[0];
    if (client.token && client.token !== token) {
      return Response.json({ error: 'Invalid token' }, { status: 403 });
    }

    const taxYear = client.tax_year || 2024;
    let submission;

    if (submissionId) {
      // Verify it's not archived before updating
      const existing = await base44.asServiceRole.entities.Submission.filter({ id: submissionId });
      if (existing?.[0] && !existing[0].is_archived) {
        submission = await base44.asServiceRole.entities.Submission.update(submissionId, data);
      } else {
        // Archived or not found — signal the client to reload
        return Response.json({ error: 'submission_archived', reload: true }, { status: 409 });
      }
    } else {
      // Check if an active (non-archived) submission for this tax_year already exists
      const existing = await base44.asServiceRole.entities.Submission.filter({ client_id, tax_year: taxYear });
      const activeExisting = existing?.find(s => !s.is_archived);
      if (activeExisting) {
        submission = await base44.asServiceRole.entities.Submission.update(activeExisting.id, data);
      } else {
        // New submission — fetch active template ID
        const templates = await base44.asServiceRole.entities.QuestionnaireTemplate.filter({ is_active: true });
        const templateId = templates && templates.length > 0
          ? templates.sort((a, b) => b.version - a.version)[0].id
          : null;

        submission = await base44.asServiceRole.entities.Submission.create({
          client_id,
          tax_year: taxYear,
          template_id: templateId,
          ...data,
        });
      }
    }

    // Only update client when status actually changes
    const newStatus = completed ? 'completed' : 'in_progress';
    if (client.status !== newStatus || completed) {
      await base44.asServiceRole.entities.Client.update(client_id, {
        last_activity: new Date().toISOString(),
        status: newStatus,
      });
    }

    return Response.json({ submission });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});