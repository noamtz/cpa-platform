import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getActivePdfTemplates — Public endpoint (no auth required).
 * Returns all active PDF templates for the questionnaire to render.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const templates = await base44.asServiceRole.entities.PdfTemplate.filter({ is_active: true });

    return Response.json({ templates: templates || [] });
  } catch (error) {
    console.error('getActivePdfTemplates error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});