import { createHash, timingSafeEqual } from "node:crypto";

import type { ClientRecord, SubmissionRecord } from "../contracts/entities";
import { forbidden, notFound } from "../core/errors";
import type { ClientRepository } from "../repositories/client";
import type { SubmissionRepository } from "../repositories/submission";

export interface PublicClientCredentials {
  readonly client_id: string;
  readonly token: string;
}

export interface PublicClientAuthorizerOptions {
  readonly clients: ClientRepository;
  readonly submissions: SubmissionRepository;
}

export function tokenMatches(stored: string, supplied: string) {
  const storedDigest = createHash("sha256").update(stored).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(storedDigest, suppliedDigest);
}

export function taxYearFor(client: ClientRecord) {
  return client.tax_year ?? 2024;
}

export class PublicClientAuthorizer {
  constructor(private readonly options: PublicClientAuthorizerOptions) {}

  async authorize(input: PublicClientCredentials): Promise<ClientRecord> {
    const client = await this.options.clients.get(input.client_id);
    if (!client || client.is_archived) {
      throw notFound("לא נמצא לקוח — פנה לרואה החשבון שלך");
    }
    if (!client.token || !tokenMatches(client.token, input.token)) {
      throw forbidden("לינק לא תקין — פנה לרואה החשבון שלך");
    }
    return client;
  }

  async activeSubmission(client: ClientRecord): Promise<SubmissionRecord | undefined> {
    const records = await this.options.submissions.query(
      { client_id: client.id, tax_year: taxYearFor(client), is_archived: false },
      "-created_date",
      1,
    );
    return records[0];
  }

  async authorizeActiveSubmission(input: PublicClientCredentials) {
    const client = await this.authorize(input);
    const submission = await this.activeSubmission(client);
    return { client, submission };
  }
}
