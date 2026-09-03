export async function loadActiveCpaSubmission(client, clientId, taxYear) {
  const submissions = await client.entities.Submission.filter({
    client_id: clientId,
    tax_year: taxYear,
    is_archived: false,
  });
  return submissions?.find((submission) => submission?.is_archived !== true) ?? null;
}
