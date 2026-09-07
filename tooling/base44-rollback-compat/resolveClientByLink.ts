type EntityRecord = Record<string, unknown>;

type Base44Client = {
  entities: {
    Client: {
      filter(
        query: Record<string, string>,
        sort?: string,
        limit?: number,
        skip?: number,
      ): Promise<EntityRecord[]>;
    };
  };
};

function one(records: EntityRecord[]): EntityRecord | null {
  if (!Array.isArray(records) || records.length > 1) {
    throw new Error("Ambiguous client link");
  }
  return records[0] ?? null;
}

/**
 * Resolves both native Base44 links and AWS-era links after rollback. Token
 * validation remains the caller's responsibility so each endpoint preserves
 * its existing status and error contract.
 */
export async function resolveClientByLink(
  base44: Base44Client,
  clientId: string,
): Promise<EntityRecord | null> {
  const direct = one(
    await base44.entities.Client.filter({ id: clientId }, "id", 2, 0),
  );
  if (direct) return direct;
  return one(
    await base44.entities.Client.filter(
      { auditflow_source_id: clientId },
      "id",
      2,
      0,
    ),
  );
}
