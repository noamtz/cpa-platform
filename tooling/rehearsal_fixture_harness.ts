import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import type { CpaActor } from "../backend/api/auth/cpa-context";
import type { ApiDependencies } from "../backend/api/handler";
import { createRuntimeDependencies } from "../backend/api/handler";

const privateFileSchema = z.object({
  path: z.string().min(1),
  content_type: z.enum([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/heic",
    "image/heif",
  ]),
});

const fixtureSchema = z
  .object({
    actor: z
      .object({
        user_id: z.string().min(1).max(256),
        email: z.string().email().max(512),
        full_name: z.string().min(1).max(512),
        cognito_subject: z.string().min(1).max(256),
      })
      .strict(),
    client: z
      .object({
        full_name: z.string().min(1).max(512),
        email: z.string().email().max(512),
        tax_year: z.number().int().positive().max(9999),
      })
      .strict(),
    client_update: z
      .object({ notes: z.string().min(1).max(4096) })
      .strict(),
    questionnaire_steps: z
      .array(
        z
          .object({
            id: z.string().min(1).max(256),
            title: z.string().min(1).max(2048),
            question: z.string().min(1).max(8192),
          })
          .passthrough(),
      )
      .min(1)
      .max(200),
    invitation_email: z.string().email().max(512).optional(),
    delete_original_file: z.boolean().default(true),
    original_file: privateFileSchema.strict(),
    replacement_file: privateFileSchema.strict(),
  })
  .strict();

interface HarnessContext {
  readonly control: { readonly run_id?: string } | undefined;
  readonly outputs: {
    readonly value: {
      readonly tableNames: Record<string, string>;
      readonly bucketNames: Record<string, string>;
      readonly userPoolId: string;
      readonly userPoolClientId: string;
    };
  };
}

interface HarnessOptions {
  readonly dependencies?: ApiDependencies;
  readonly fetchImpl?: typeof fetch;
}

function configureRuntime(outputs: HarnessContext["outputs"]["value"]) {
  const names = outputs.tableNames;
  const buckets = outputs.bucketNames;
  const environment = {
    CLIENT_TABLE_NAME: names.ClientTable,
    SUBMISSION_TABLE_NAME: names.SubmissionTable,
    QUESTIONNAIRE_TEMPLATE_TABLE_NAME: names.QuestionnaireTemplateTable,
    PDF_TEMPLATE_TABLE_NAME: names.PdfTemplateTable,
    USER_TABLE_NAME: names.UserTable,
    CHANGE_JOURNAL_TABLE_NAME: names.ChangeJournalTable,
    FILES_BUCKET_NAME: buckets.FilesBucket,
    TEMPORARY_OUTPUTS_BUCKET_NAME: buckets.TemporaryOutputsBucket,
    USER_POOL_ID: outputs.userPoolId,
    USER_POOL_CLIENT_ID: outputs.userPoolClientId,
    AUDITFLOW_STAGE: "test",
  };
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("fixture_runtime_binding_invalid");
    }
    process.env[key] = value;
  }
}

function privateBytes(path: string) {
  const absolute = resolve(path);
  const repository = resolve(process.cwd());
  if (absolute === repository || absolute.startsWith(`${repository}\\`)) {
    throw new Error("fixture_private_path_required");
  }
  return readFileSync(absolute);
}

async function uploadFixture(
  dependencies: ApiDependencies,
  actor: CpaActor,
  submissionId: string,
  file: z.infer<typeof privateFileSchema>,
  requestId: string,
  fetchImpl: typeof fetch,
) {
  const bytes = privateBytes(file.path);
  const initiated = await dependencies.files.initiateCpaUpload(
    {
      owner_type: "submission",
      owner_id: submissionId,
      purpose: "questionnaire_document",
      size: bytes.length,
      content_type: file.content_type,
    },
    actor,
    requestId,
  );
  const response = await fetchImpl(initiated.upload_url, {
    method: "PUT",
    headers: initiated.headers,
    body: bytes,
    redirect: "error",
  });
  if (!response.ok) throw new Error("fixture_upload_failed");
  return dependencies.files.completeCpaUpload(
    {
      owner_type: "submission",
      owner_id: submissionId,
      upload_id: initiated.upload_id,
    },
    actor,
    `${requestId}-complete`,
  );
}

export async function runRehearsalFixtures(
  context: HarnessContext,
  rawFixture: unknown,
  options: HarnessOptions = {},
) {
  const fixture = fixtureSchema.parse(rawFixture);
  if (!context.control?.run_id) throw new Error("fixture_run_not_bound");
  if (!options.dependencies) configureRuntime(context.outputs.value);
  const dependencies = options.dependencies ?? createRuntimeDependencies();
  if (!dependencies.templates) throw new Error("fixture_templates_unavailable");
  const actor: CpaActor = {
    userId: fixture.actor.user_id,
    email: fixture.actor.email,
    fullName: fixture.actor.full_name,
    cognitoSubject: fixture.actor.cognito_subject,
    role: "admin",
  };
  const requestPrefix = `rollback-rehearsal-${context.control.run_id}`;
  const client = await dependencies.entities.createClient(
    actor,
    `${requestPrefix}-client-create`,
    fixture.client,
  );
  await dependencies.entities.updateClient(
    actor,
    `${requestPrefix}-client-update`,
    String(client.id),
    fixture.client_update,
  );
  await dependencies.templates.saveQuestionnaire(
    { steps: fixture.questionnaire_steps },
    actor,
    `${requestPrefix}-questionnaire`,
  );
  const created = await dependencies.publicQuestionnaire.updateClientSubmission(
    {
      client_id: String(client.id),
      token: String(client.token),
      submission_id: null,
      data: { responses: JSON.stringify({ rehearsal: [] }) },
      completed: false,
    },
    `${requestPrefix}-submission-create`,
  );
  const submissionId = String(created.submission.id);
  const original = await uploadFixture(
    dependencies,
    actor,
    submissionId,
    fixture.original_file,
    `${requestPrefix}-original`,
    options.fetchImpl ?? fetch,
  );
  const updated = await dependencies.publicQuestionnaire.updateClientSubmission(
    {
      client_id: String(client.id),
      token: String(client.token),
      submission_id: submissionId,
      _version: Number(created.submission._version),
      data: {
        responses: JSON.stringify({ rehearsal: [{ file_url: original.file_uri }] }),
      },
      completed: false,
    },
    `${requestPrefix}-submission-original`,
  );
  const replacement = await uploadFixture(
    dependencies,
    actor,
    submissionId,
    fixture.replacement_file,
    `${requestPrefix}-replacement`,
    options.fetchImpl ?? fetch,
  );
  await dependencies.publicQuestionnaire.updateClientSubmission(
    {
      client_id: String(client.id),
      token: String(client.token),
      submission_id: submissionId,
      _version: Number(updated.submission._version),
      data: {
        responses: JSON.stringify({ rehearsal: [{ file_url: replacement.file_uri }] }),
      },
      completed: false,
    },
    `${requestPrefix}-submission-replacement`,
  );
  if (fixture.delete_original_file) {
    await dependencies.files.deleteOwnedFile({
      reference: original.file_uri,
      ownerType: "submission",
      ownerId: submissionId,
      actor,
      requestId: `${requestPrefix}-file-delete`,
    });
  }
  if (fixture.invitation_email) {
    await dependencies.userService.invite(
      actor,
      `${requestPrefix}-invite`,
      { email: fixture.invitation_email, role: "admin" },
    );
  }
  return {
    status: "fixtures_created",
    entityMutations: fixture.invitation_email ? 7 : 6,
    fileCreates: 2,
    fileDeletes: fixture.delete_original_file ? 1 : 0,
    invitations: fixture.invitation_email ? 1 : 0,
  } as const;
}
