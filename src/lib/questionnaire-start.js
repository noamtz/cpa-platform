export async function startQuestionnaireWithSubmission({
  submission,
  createSubmission,
  showFirstStep,
}) {
  const activeSubmission = submission || (await createSubmission());
  if (!activeSubmission?.id || !activeSubmission?._version) return false;
  showFirstStep(activeSubmission);
  return true;
}
