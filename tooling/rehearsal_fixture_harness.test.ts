import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ApiDependencies } from "../backend/api/handler";
import { runRehearsalFixtures } from "./rehearsal_fixture_harness";

describe("controlled rehearsal fixture harness", () => {
  it("creates the ordered invented mutation and file-replacement graph", async () => {
    const root = mkdtempSync(join(tmpdir(), "auditflow-fixture-harness-"));
    const originalPath = join(root, "original.bin");
    const replacementPath = join(root, "replacement.bin");
    writeFileSync(originalPath, "original");
    writeFileSync(replacementPath, "replacement");
    let submissionRevision = 0;
    let upload = 0;
    const dependencies = {
      entities: {
        createClient: vi.fn().mockResolvedValue({
          id: "client-test",
          token: "fixture-token",
        }),
        updateClient: vi.fn().mockResolvedValue({}),
      },
      templates: {
        saveQuestionnaire: vi.fn().mockResolvedValue({}),
      },
      publicQuestionnaire: {
        updateClientSubmission: vi.fn(async () => ({
          submission: {
            id: "submission-test",
            _version: (submissionRevision += 1),
          },
        })),
      },
      files: {
        initiateCpaUpload: vi.fn(async () => ({
          upload_id: `private://files/test-${(upload += 1)}`,
          upload_url: "https://upload.invalid",
          headers: { "content-type": "application/pdf" },
        })),
        completeCpaUpload: vi.fn(async (input) => ({ file_uri: input.upload_id })),
        deleteOwnedFile: vi.fn().mockResolvedValue({ deleted: true }),
      },
      userService: {
        invite: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ApiDependencies;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(
      runRehearsalFixtures(
        {
          control: { run_id: "run-test" },
          outputs: {
            value: {
              tableNames: {},
              bucketNames: {},
              userPoolId: "unused",
              userPoolClientId: "unused",
            },
          },
        },
        {
          actor: {
            user_id: "actor-test",
            email: "actor@example.invalid",
            full_name: "Invented Operator",
            cognito_subject: "subject-test",
          },
          client: {
            full_name: "Invented Client",
            email: "client@example.invalid",
            tax_year: 2026,
          },
          client_update: { notes: "Invented update" },
          questionnaire_steps: [
            { id: "proof", title: "Proof", question: "Attach an invented file" },
          ],
          invitation_email: "invite@example.invalid",
          original_file: { path: originalPath, content_type: "application/pdf" },
          replacement_file: { path: replacementPath, content_type: "application/pdf" },
        },
        { dependencies, fetchImpl },
      ),
    ).resolves.toMatchObject({
      status: "fixtures_created",
      fileCreates: 2,
      fileDeletes: 1,
      invitations: 1,
    });
    expect(dependencies.publicQuestionnaire.updateClientSubmission).toHaveBeenCalledTimes(3);
    expect(dependencies.files.completeCpaUpload).toHaveBeenCalledTimes(2);
    expect(dependencies.files.deleteOwnedFile).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
