import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getTemplateFileUrl — Secure endpoint to get a signed URL for a PDF template file.
 * Input: { client_id, token, template_id }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { client_id, token, template_id } = await req.json();

    if (!client_id || !token || !template_id) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Validate client ownership via token
    const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });
    const client = clients?.[0];
    if (!client || client.token !== token) {
      return Response.json({ error: 'Invalid client or token' }, { status: 403 });
    }

    // Load the PDF template
    const templates = await base44.asServiceRole.entities.PdfTemplate.filter({ id: template_id });
    const template = templates?.[0];
    if (!template) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    // Extract the basePdf file_uri from template_json
    let fileUri = null;
    try {
      const templateData = JSON.parse(template.template_json);
      const basePdf = templateData?.basePdf;
      if (typeof basePdf === 'string' && basePdf.startsWith('private://')) {
        fileUri = basePdf;
      } else if (basePdf?.__type === 'file_uri') {
        fileUri = basePdf.value;
      }
    } catch {
      return Response.json({ error: 'Invalid template data' }, { status: 500 });
    }

    if (!fileUri) {
      return Response.json({ error: 'Template has no base PDF file' }, { status: 404 });
    }

    const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: fileUri,
      expires_in: 3600,
    });

    return Response.json({ signed_url });
  } catch (error) {
    console.error('getTemplateFileUrl error:', error);
    return Response.json({ error: error.message || 'Server error' }, { status: 500 });
  }
});