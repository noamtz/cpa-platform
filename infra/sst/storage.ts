import { bucketContracts, tableContracts } from "./contracts";
import type { StageSettings } from "./stage";

type TableLogicalName = (typeof tableContracts)[number]["logicalName"];
type BucketLogicalName = (typeof bucketContracts)[number]["logicalName"];

export function createStorage(
  stage: StageSettings,
  routerOrigin: $util.Input<string>,
) {
  const tableEntries = tableContracts.map((contract) => {
    const table = new sst.aws.Dynamo(
      contract.logicalName,
      {
        fields: contract.fields,
        primaryIndex: contract.primaryIndex,
        globalIndexes: contract.globalIndexes,
        deletionProtection: stage.isProduction,
        transform: {
          table(args, opts) {
            args.billingMode = "PAY_PER_REQUEST";
            args.pointInTimeRecovery = { enabled: true };
            if (stage.isProduction) {
              opts.retainOnDelete = true;
            }
          },
        },
      },
      { retainOnDelete: stage.isProduction },
    );

    return [contract.logicalName, table] as const;
  });

  const bucketEntries = bucketContracts.map((contract) => {
    const expirationDays =
      "expirationDays" in contract ? contract.expirationDays : undefined;
    const bucket = new sst.aws.Bucket(
      contract.logicalName,
      {
        cors:
          contract.cors === false
            ? false
            : {
                allowHeaders: [...contract.cors.allowHeaders],
                allowMethods: [...contract.cors.allowMethods],
                allowOrigins: stage.isProduction
                  ? [routerOrigin]
                  : [routerOrigin, "http://localhost:5173"],
                exposeHeaders: [...contract.cors.exposeHeaders],
                maxAge: contract.cors.maxAge,
              },
        enforceHttps: contract.enforceHttps,
        versioning: contract.versioning,
        lifecycle: expirationDays
          ? [
              {
                id: "expire-temporary-outputs",
                expiresIn: `${expirationDays} day`,
              },
            ]
          : undefined,
        transform: {
          bucket(_args, opts) {
            if (stage.isProduction) {
              opts.retainOnDelete = true;
            }
          },
        },
      },
      { retainOnDelete: stage.isProduction },
    );

    return [contract.logicalName, bucket] as const;
  });

  const tables = Object.fromEntries(tableEntries) as Record<
    TableLogicalName,
    sst.aws.Dynamo
  >;
  const buckets = Object.fromEntries(bucketEntries) as Record<
    BucketLogicalName,
    sst.aws.Bucket
  >;

  return {
    tables,
    buckets,
    tableList: Object.values(tables),
    bucketList: Object.values(buckets),
  };
}

export type FoundationStorage = ReturnType<typeof createStorage>;
