import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { file_uri } = await req.json();

    if (!file_uri) {
      return Response.json({ error: 'file_uri is required' }, { status: 400 });
    }

    const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri,
      expires_in: 3600,
    });

    return Response.json({ signed_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});