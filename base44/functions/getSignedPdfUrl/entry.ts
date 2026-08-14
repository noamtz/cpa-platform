import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getSignedPdfUrl — Secure endpoint to retrieve a signed URL for a client's signed PDF.
 * Input: { client_id, token, step_id }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { client_id, token, step_id } = await req.json();

    if (!client_id || !token || !step_id) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Validate client ownership via token
    const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });
    const client = clients?.[0];
    if (!client || client.token !== token) {
      return Response.json({ error: 'Invalid client or token' }, { status: 403 });
    }

    // Find the submission for this client
    const submissions = await base44.asServiceRole.entities.Submission.filter({ client_id });
    const submission = submissions?.find((s) => s.signed_pdfs);
    if (!submission?.signed_pdfs) {
      return Response.json({ error: 'No signed PDFs found' }, { status: 404 });
    }

    let signedPdfs;
    try {
      signedPdfs = JSON.parse(submission.signed_pdfs);
    } catch {
      return Response.json({ error: 'Invalid signed_pdfs data' }, { status: 500 });
    }

    const record = signedPdfs.find((r) => r.step_id === step_id);
    if (!record?.pdf_file_url) {
      return Response.json({ error: 'PDF file not found for this step' }, { status: 404 });
    }

    const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: record.pdf_file_url,
      expires_in: 3600,
    });

    return Response.json({ signed_url });
  } catch (error) {
    console.error('getSignedPdfUrl error:', error);
    return Response.json({ error: error.message || 'Server error' }, { status: 500 });
  }
});