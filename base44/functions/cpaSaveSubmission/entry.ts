import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Must be authenticated CPA
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { client_id, submission_id, step_id, data, completed } = await req.json();

    if (!client_id) {
      return Response.json({ error: 'Missing client_id' }, { status: 400 });
    }

    // Load client
    const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });
    if (!clients || clients.length === 0) {
      return Response.json({ error: 'Client not found' }, { status: 404 });
    }
    const client = clients[0];
    const taxYear = client.tax_year || 2024;

    // Build audit entry for this save
    const auditEntry = {
      cpa_email: user.email,
      cpa_name: user.full_name || user.email,
      step_id: step_id || null,
      timestamp: new Date().toISOString(),
      action: completed ? 'complete' : (data?.responses ? 'fill' : 'fill'),
    };

    // Find or create submission
    let submission;
    if (submission_id) {
      // Load existing to get current audit log
      const existing = await base44.asServiceRole.entities.Submission.filter({ id: submission_id });
      submission = existing?.[0];
    } else {
      const existing = await base44.asServiceRole.entities.Submission.filter({ client_id, tax_year: taxYear });
      submission = existing?.[0];
    }

    // Merge audit log
    let auditLog = [];
    if (submission?.cpa_audit_log) {
      try { auditLog = JSON.parse(submission.cpa_audit_log); } catch {}
    }
    auditLog.push(auditEntry);

    const saveData = {
      ...data,
      cpa_audit_log: JSON.stringify(auditLog),
    };

    if (submission) {
      submission = await base44.asServiceRole.entities.Submission.update(submission.id, saveData);
    } else {
      // New submission
      const templates = await base44.asServiceRole.entities.QuestionnaireTemplate.filter({ is_active: true });
      const templateId = templates && templates.length > 0
        ? templates.sort((a, b) => b.version - a.version)[0].id
        : null;

      submission = await base44.asServiceRole.entities.Submission.create({
        client_id,
        tax_year: taxYear,
        template_id: templateId,
        ...saveData,
      });
    }

    // Update client status
    const newStatus = completed ? 'completed' : 'in_progress';
    await base44.asServiceRole.entities.Client.update(client_id, {
      last_activity: new Date().toISOString(),
      status: newStatus,
    });

    return Response.json({ submission, audit_entry: auditEntry });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});