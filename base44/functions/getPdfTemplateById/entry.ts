import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getPdfTemplateById — Public endpoint (no auth required).
 * Loads a single PdfTemplate by ID for the client questionnaire signing flow.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { template_id } = await req.json();

    if (!template_id) {
      return Response.json({ error: 'template_id is required' }, { status: 400 });
    }

    const templates = await base44.asServiceRole.entities.PdfTemplate.filter({ id: template_id });

    if (!templates || templates.length === 0) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    return Response.json({ template: templates[0] });
  } catch (error) {
    console.error('getPdfTemplateById error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});