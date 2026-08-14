import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    let base44Service;
    try {
      const base44 = createClientFromRequest(req);
      base44Service = base44.asServiceRole;
    } catch {
      const { createClient } = await import('npm:@base44/sdk@0.8.25');
      const base44 = createClient({ appId: Deno.env.get('BASE44_APP_ID'), mode: 'service_role' });
      base44Service = base44;
    }

    // Fetch all templates sorted by version descending
    const templates = await base44Service.entities.QuestionnaireTemplate.list('-version', 100);

    const versions = templates.map(t => ({
      id: t.id,
      version: t.version,
      is_active: t.is_active,
      created_at: t.created_at,
      created_by_email: t.created_by_email,
      steps_count: JSON.parse(t.steps || '[]').length,
    }));

    return Response.json({ versions });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});