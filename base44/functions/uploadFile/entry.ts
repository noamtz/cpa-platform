import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Two auth paths:
    // 1. Client token (public pages) — client_id + token in URL params
    // 2. Base44 auth (CPA dashboard) — JWT in request headers
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    const token = url.searchParams.get('token');

    if (clientId && token) {
      // Client token validation
      const clients = await base44.asServiceRole.entities.Client.filter({ id: clientId });
      const client = clients?.[0];
      if (!client || client.token !== token) {
        return Response.json({ error: 'Invalid client or token' }, { status: 403 });
      }
    } else {
      // CPA auth validation — verify the caller is a logged-in user
      try {
        await base44.auth.me();
      } catch {
        return Response.json({ error: 'Authentication required' }, { status: 401 });
      }
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const result = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });

    return Response.json({ file_uri: result.file_uri });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});