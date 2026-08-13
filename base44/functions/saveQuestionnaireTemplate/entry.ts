import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { steps } = await req.json();

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return Response.json({ error: 'Steps array is required' }, { status: 400 });
    }

    // Validate each step has required fields
    for (const step of steps) {
      if (!step.id || !step.title || !step.question) {
        return Response.json({ error: `Step "${step.id || 'unknown'}" is missing required fields (id, title, question)` }, { status: 400 });
      }
    }

    // Deactivate all current active templates
    const activeTemplates = await base44.asServiceRole.entities.QuestionnaireTemplate.filter({ is_active: true });
    let nextVersion = 1;

    for (const t of (activeTemplates || [])) {
      await base44.asServiceRole.entities.QuestionnaireTemplate.update(t.id, { is_active: false });
      if (t.version >= nextVersion) {
        nextVersion = t.version + 1;
      }
    }

    // Create the new template version
    const newTemplate = await base44.asServiceRole.entities.QuestionnaireTemplate.create({
      version: nextVersion,
      is_active: true,
      steps: JSON.stringify(steps),
      created_at: new Date().toISOString(),
    });

    return Response.json({
      template: {
        id: newTemplate.id,
        version: nextVersion,
        steps,
        created_at: newTemplate.created_at,
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
