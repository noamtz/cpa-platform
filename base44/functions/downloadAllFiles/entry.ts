import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import JSZip from 'npm:jszip@3.10.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { files, clientName } = await req.json();

    if (!files || files.length === 0) {
      return Response.json({ error: 'No files provided' }, { status: 400 });
    }

    const zip = new JSZip();

    await Promise.all(
      files.map(async ({ url, label, index }) => {
        try {
          // All stored files are private URIs — always generate a signed URL
          const signedResult = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
            file_uri: url,
            expires_in: 3600
          });
          const downloadUrl = signedResult.signed_url;

          const res = await fetch(downloadUrl);
          if (!res.ok) return;
          const buffer = await res.arrayBuffer();
          const contentType = res.headers.get('content-type') || '';
          let ext = 'file';
          if (contentType.includes('pdf')) ext = 'pdf';
          else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
          else if (contentType.includes('png')) ext = 'png';
          else {
            const urlExt = downloadUrl.split('?')[0].split('.').pop();
            if (urlExt && urlExt.length <= 5) ext = urlExt;
          }
          const filename = `${label}_${index + 1}.${ext}`;
          zip.file(filename, buffer);
        } catch (err) {
          // silently skip failed files
        }
      })
    );

    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    const safeName = (clientName || 'מסמכים').replace(/[^a-zA-Z0-9א-ת\s]/g, '');

    return new Response(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(safeName)}.zip"`,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});