import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CONNECTOR_ID = '69fb22f94d2b7077430e5187';

// Batch-generate signed URLs for multiple private files
async function getSignedUrls(base44, fileUris) {
  const results = {};
  const privateUris = fileUris.filter(uri => uri.startsWith('mp/') || uri.startsWith('private/'));
  
  const signedResults = await Promise.all(
    privateUris.map(uri =>
      base44.integrations.Core.CreateFileSignedUrl({ file_uri: uri, expires_in: 3600 })
        .then(r => ({ uri, url: r?.signed_url || null }))
        .catch(() => ({ uri, url: null }))
    )
  );
  
  for (const { uri, url } of signedResults) {
    results[uri] = url;
  }
  return results;
}

async function ensureFolder(accessToken, parentFolderId, folderName) {
  const query = `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentFolderId}' in parents`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();
  if (!searchRes.ok) throw new Error(`Drive search failed: ${JSON.stringify(searchData?.error || searchData)}`);
  if (searchData.files?.length > 0) return searchData.files[0].id;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] }),
  });
  const createData = await createRes.json();
  if (!createRes.ok) throw new Error(`Drive folder create failed: ${JSON.stringify(createData?.error || createData)}`);
  return createData.id;
}

async function uploadFileToFolder(accessToken, folderId, fileUrl, fileName) {
  try {
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) return null;
    const fileBuffer = await fileRes.arrayBuffer();
    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    const boundary = '-------314159265358979323846';
    const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const metaPart = `${delimiter}Content-Type: application/json\r\n\r\n${metadata}`;
    const filePart = `${delimiter}Content-Type: ${contentType}\r\n\r\n`;
    const encoder = new TextEncoder();
    const metaBytes = encoder.encode(metaPart);
    const filePartBytes = encoder.encode(filePart);
    const closeBytes = encoder.encode(closeDelimiter);
    const body = new Uint8Array(metaBytes.length + filePartBytes.length + fileBuffer.byteLength + closeBytes.length);
    body.set(metaBytes, 0);
    body.set(filePartBytes, metaBytes.length);
    body.set(new Uint8Array(fileBuffer), metaBytes.length + filePartBytes.length);
    body.set(closeBytes, metaBytes.length + filePartBytes.length + fileBuffer.byteLength);
    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body,
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) return null;
    return uploadData.id;
  } catch (e) {
    console.error('[Upload error]', fileName, e.message);
    return null;
  }
}

async function handleCheckConnection(base44) {
  const { accessToken } = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
  if (!accessToken) throw new Error('No access token');
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Drive access failed');
  return Response.json({ connected: true, email: data.user?.emailAddress || null });
}

// Collect all file URIs from a submission
function collectFileUris(submission) {
  const uris = [];
  let responses = {};
  if (submission.responses) { try { responses = JSON.parse(submission.responses); } catch {} }
  let signedPdfs = [];
  if (submission.signed_pdfs) { try { signedPdfs = JSON.parse(submission.signed_pdfs); } catch {} }
  for (const [, stepData] of Object.entries(responses)) {
    for (const f of (stepData?.files || [])) uris.push(f);
  }
  for (const record of signedPdfs) {
    if (record.pdf_file_url) uris.push(record.pdf_file_url);
  }
  return { uris, responses, signedPdfs };
}

// Sync a single submission with a pre-loaded syncedUrls Set (no extra DB query)
async function syncSubmissionWithSyncedSet(base44, accessToken, driveBasePath, submission, client, syncedUrls, folderCache, signedUrlCache) {
  const { uris, responses, signedPdfs } = collectFileUris(submission);
  const pending = uris.filter(u => !syncedUrls.has(u));
  if (pending.length === 0) return { uploadCount: 0, skippedCount: uris.length };

  // Generate signed URLs upfront for all private files
  const privateUris = pending.filter(u => u.startsWith('mp/') || u.startsWith('private/'));
  if (privateUris.length > 0) {
    const newSignedUrls = await getSignedUrls(base44, privateUris);
    Object.assign(signedUrlCache, newSignedUrls);
  }

  // Build base folder structure using cache
  let baseFolderId = 'root';
  if (driveBasePath) {
    const parts = driveBasePath.split('/').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const cacheKey = `root/${part}`;
      if (!folderCache[cacheKey]) {
        folderCache[cacheKey] = await ensureFolder(accessToken, baseFolderId, part);
      }
      baseFolderId = folderCache[cacheKey];
    }
  }
  const clientKey = `${baseFolderId}/${client.full_name}`;
  if (!folderCache[clientKey]) {
    folderCache[clientKey] = await ensureFolder(accessToken, baseFolderId, client.full_name);
  }
  const clientFolderId = folderCache[clientKey];
  
  const yearKey = `${clientFolderId}/${submission.tax_year || 2024}`;
  if (!folderCache[yearKey]) {
    folderCache[yearKey] = await ensureFolder(accessToken, clientFolderId, String(submission.tax_year || 2024));
  }
  const yearFolderId = folderCache[yearKey];

  let uploadCount = 0;
  let skippedCount = uris.length - pending.length;
  const uploadQueue = [];

  async function syncFile(fileUri, folderId, fileName) {
    if (syncedUrls.has(fileUri)) { skippedCount++; return; }
    const isPrivate = fileUri.startsWith('mp/') || fileUri.startsWith('private/');
    const fileUrl = isPrivate ? signedUrlCache[fileUri] : fileUri;
    if (!fileUrl) return;
    const driveFileId = await uploadFileToFolder(accessToken, folderId, fileUrl, fileName);
    if (driveFileId) {
      uploadCount++;
      syncedUrls.add(fileUri);
      await base44.asServiceRole.entities.SyncedDriveFile.create({
        submission_id: submission.id,
        original_file_url: fileUri,
        drive_file_id: driveFileId,
        drive_parent_folder_id: folderId,
        file_name_on_drive: fileName,
        synced_at: new Date().toISOString(),
      });
    }
  }

  // Collect all upload tasks, then parallelize in batches
  for (const [stepId, stepData] of Object.entries(responses)) {
    const files = stepData?.files || [];
    if (files.length === 0) continue;
    const folderLabel = stepData?.title || stepId;
    const folderCacheKey = `${yearFolderId}/${folderLabel}`;
    if (!folderCache[folderCacheKey]) {
      folderCache[folderCacheKey] = await ensureFolder(accessToken, yearFolderId, folderLabel);
    }
    const typeFolderId = folderCache[folderCacheKey];
    for (let i = 0; i < files.length; i++) {
      const fileUri = files[i];
      const ext = (fileUri.split('?')[0].split('.').pop()) || 'file';
      uploadQueue.push(syncFile(fileUri, typeFolderId, `${folderLabel} - קובץ ${i + 1}.${ext}`));
    }
  }

  for (const record of signedPdfs) {
    if (!record.pdf_file_url) continue;
    const folderLabel = record.step_title || record.template_name || 'טפסים חתומים';
    const folderCacheKey = `${yearFolderId}/${folderLabel}`;
    if (!folderCache[folderCacheKey]) {
      folderCache[folderCacheKey] = await ensureFolder(accessToken, yearFolderId, folderLabel);
    }
    const typeFolderId = folderCache[folderCacheKey];
    uploadQueue.push(syncFile(record.pdf_file_url, typeFolderId, `${folderLabel} - חתום.pdf`));
  }

  // Parallelize uploads in batches of 5 (respects Drive rate limits)
  const BATCH_SIZE = 5;
  for (let i = 0; i < uploadQueue.length; i += BATCH_SIZE) {
    const batch = uploadQueue.slice(i, i + BATCH_SIZE);
    await Promise.all(batch);
  }

  return { uploadCount, skippedCount };
}

// Sync a single submission (legacy — queries DB itself)
async function syncSubmission(base44, accessToken, driveBasePath, submission, client) {
  const { uris, responses, signedPdfs } = collectFileUris(submission);

  // Load existing sync records
  const existingSyncRecords = await base44.asServiceRole.entities.SyncedDriveFile.filter({ submission_id: submission.id }, null, 1000);
  const syncedUrls = new Set(existingSyncRecords.map(r => r.original_file_url));

  // Early exit if nothing to do
  const pending = uris.filter(u => !syncedUrls.has(u));
  if (pending.length === 0) {
    return { uploadCount: 0, skippedCount: uris.length };
  }

  // Build folder structure
  let baseFolderId = 'root';
  if (driveBasePath) {
    const parts = driveBasePath.split('/').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      baseFolderId = await ensureFolder(accessToken, baseFolderId, part);
    }
  }
  const clientFolderId = await ensureFolder(accessToken, baseFolderId, client.full_name);
  const yearFolderId = await ensureFolder(accessToken, clientFolderId, String(submission.tax_year || 2024));

  let uploadCount = 0;
  let skippedCount = uris.length - pending.length; // already-synced ones

  async function syncFile(fileUri, folderId, fileName) {
    if (syncedUrls.has(fileUri)) { skippedCount++; return; }
    const isPrivate = fileUri.startsWith('mp/') || fileUri.startsWith('private/');
    let fileUrl = fileUri;
    if (isPrivate) {
      const r = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: fileUri, expires_in: 3600 }).catch(() => null);
      fileUrl = r?.signed_url || null;
    }
    if (!fileUrl) return;
    const driveFileId = await uploadFileToFolder(accessToken, folderId, fileUrl, fileName);
    if (driveFileId) {
      uploadCount++;
      await base44.asServiceRole.entities.SyncedDriveFile.create({
        submission_id: submission.id,
        original_file_url: fileUri,
        drive_file_id: driveFileId,
        drive_parent_folder_id: folderId,
        file_name_on_drive: fileName,
        synced_at: new Date().toISOString(),
      });
    }
  }

  for (const [stepId, stepData] of Object.entries(responses)) {
    const files = stepData?.files || [];
    if (files.length === 0) continue;
    const folderLabel = stepData?.title || stepId;
    const typeFolderId = await ensureFolder(accessToken, yearFolderId, folderLabel);
    for (let i = 0; i < files.length; i++) {
      const fileUri = files[i];
      const ext = (fileUri.split('?')[0].split('.').pop()) || 'file';
      await syncFile(fileUri, typeFolderId, `${folderLabel} - קובץ ${i + 1}.${ext}`);
    }
  }

  for (const record of signedPdfs) {
    if (!record.pdf_file_url) continue;
    const folderLabel = record.step_title || record.template_name || 'טפסים חתומים';
    const typeFolderId = await ensureFolder(accessToken, yearFolderId, folderLabel);
    await syncFile(record.pdf_file_url, typeFolderId, `${folderLabel} - חתום.pdf`);
  }

  return { uploadCount, skippedCount };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    if (body.check_connection) return handleCheckConnection(base44);

    // ── BATCH MODE: sync all submissions in one call ──
    if (body.sync_all) {
      const submissionIds = body.submission_ids; // array of { submission_id, client_id }
      if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
        return Response.json({ error: 'Missing submission_ids' }, { status: 400 });
      }

      // Load submissions + clients in batches of 20 to avoid overwhelming the DB
      const BATCH_SIZE = 20;
      const validPairs = [];
      for (let i = 0; i < submissionIds.length; i += BATCH_SIZE) {
        const chunk = submissionIds.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          chunk.map(async ({ submission_id, client_id }) => {
            try {
              const [submission, client] = await Promise.all([
                base44.asServiceRole.entities.Submission.get(submission_id),
                base44.asServiceRole.entities.Client.get(client_id),
              ]);
              return { submission, client };
            } catch { return null; }
          })
        );
        validPairs.push(...results.filter(Boolean));
      }

      // Load ALL synced file records in one DB query (no per-submission queries)
      const subIdSet = new Set(validPairs.map(p => p.submission.id));
      const allSyncedRecords = await base44.asServiceRole.entities.SyncedDriveFile.list(null, 10000);
      // Build a map: submission_id -> Set of synced URIs
      const syncedBySubmission = {};
      for (const record of allSyncedRecords) {
        if (!subIdSet.has(record.submission_id)) continue;
        if (!syncedBySubmission[record.submission_id]) syncedBySubmission[record.submission_id] = new Set();
        syncedBySubmission[record.submission_id].add(record.original_file_url);
      }

      // Determine which submissions actually need Drive work
      const needsSync = validPairs.filter(({ submission }) => {
        const { uris } = collectFileUris(submission);
        const synced = syncedBySubmission[submission.id] || new Set();
        return uris.some(u => !synced.has(u));
      });

      let totalUploaded = 0;
      let totalSkipped = validPairs.length - needsSync.length;

      if (needsSync.length > 0) {
        const { accessToken } = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
        const driveBasePath = user?.drive_base_path || '';
        const folderCache = {}; // Shared folder ID cache across all submissions
        const signedUrlCache = {}; // Shared signed URL cache

        for (const { submission, client } of needsSync) {
          const result = await syncSubmissionWithSyncedSet(
            base44, accessToken, driveBasePath, submission, client,
            syncedBySubmission[submission.id] || new Set(),
            folderCache,
            signedUrlCache
          );
          totalUploaded += result.uploadCount;
          totalSkipped += result.skippedCount;
        }
      }

      return Response.json({ success: true, uploadCount: totalUploaded, skippedCount: totalSkipped });
    }

    // ── SINGLE MODE (legacy) ──
    const { submission_id, client_id } = body;
    if (!submission_id || !client_id) {
      return Response.json({ error: 'Missing submission_id or client_id' }, { status: 400 });
    }

    let submission, client;
    try {
      [submission, client] = await Promise.all([
        base44.asServiceRole.entities.Submission.get(submission_id),
        base44.asServiceRole.entities.Client.get(client_id),
      ]);
    } catch {
      return Response.json({ error: 'Client or submission not found', skipped: true }, { status: 404 });
    }
    if (!submission || !client) {
      return Response.json({ error: 'Client or submission not found', skipped: true }, { status: 404 });
    }

    const { uris } = collectFileUris(submission);
    const existingSyncRecords = await base44.asServiceRole.entities.SyncedDriveFile.filter({ submission_id }, null, 1000);
    const syncedUrls = new Set(existingSyncRecords.map(r => r.original_file_url));
    const pending = uris.filter(u => !syncedUrls.has(u));
    if (pending.length === 0) {
      return Response.json({ success: true, uploadCount: 0, skippedCount: uris.length });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
    const result = await syncSubmission(base44, accessToken, user?.drive_base_path || '', submission, client);
    return Response.json({ success: true, ...result });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});