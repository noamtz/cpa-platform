import { createClient } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const { template_id } = await req.json();

    if (!template_id) {
      return Response.json({ error: 'Missing template_id' }, { status: 400 });
    }

    const base44 = createClient({ appId: Deno.env.get('BASE44_APP_ID'), mode: 'service_role' });

    const templates = await base44.entities.QuestionnaireTemplate.filter({ id: template_id });

    if (!templates || templates.length === 0) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    const template = templates[0];
    return Response.json({
      template: {
        id: template.id,
        version: template.version,
        steps: JSON.parse(template.steps),
        created_at: template.created_at,
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});