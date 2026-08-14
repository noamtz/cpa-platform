import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const { submission_id } = await req.json();

    if (!submission_id) {
      return Response.json({ error: 'Missing submission_id' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const base44Service = base44.asServiceRole;

    const submissions = await base44Service.entities.Submission.filter({ id: submission_id });
    if (!submissions || submissions.length === 0) {
      return Response.json({ error: 'Submission not found' }, { status: 404 });
    }

    const submission = submissions[0];
    const fileUris = [];

    // Collect legacy flat-field files
    ['form_106_files', 'pension_files', 'form_867_files', 'insurance_files', 'donation_files'].forEach((field) => {
      if (Array.isArray(submission[field])) {
        fileUris.push(...submission[field]);
      }
    });

    // Collect files from new dynamic responses format
    if (submission.responses) {
      try {
        const responses = typeof submission.responses === 'string'
          ? JSON.parse(submission.responses)
          : submission.responses;
        for (const response of Object.values(responses)) {
          if (Array.isArray(response?.files)) {
            fileUris.push(...response.files);
          }
        }
      } catch {}
    }

    // Collect signed PDF files
    if (submission.signed_pdfs) {
      try {
        const signedPdfs = typeof submission.signed_pdfs === 'string'
          ? JSON.parse(submission.signed_pdfs)
          : submission.signed_pdfs;
        for (const record of signedPdfs) {
          if (record?.pdf_file_url) fileUris.push(record.pdf_file_url);
        }
      } catch {}
    }

    // Delete all files (fire and forget)
    fileUris.forEach((fileUri) => {
      base44Service.integrations.Core.DeleteFile({ file_uri: fileUri }).catch(() => {});
    });

    await base44Service.entities.Submission.delete(submission_id);

    return Response.json({ success: true, deletedFiles: fileUris.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});