import { authContract } from "./contracts";
import type { StageSettings } from "./stage";

export function createAuthentication(stage: StageSettings) {
  const userPool = new sst.aws.CognitoUserPool(
    authContract.userPoolLogicalName,
    {
      usernames: [authContract.signInAlias],
      transform: {
        userPool(args, opts) {
          if (stage.isProduction) {
            args.deletionProtection = "ACTIVE";
            opts.retainOnDelete = true;
          }
        },
      },
    },
    { retainOnDelete: stage.isProduction },
  );

  const userPoolClient = userPool.addClient(
    authContract.userPoolClientLogicalName,
    {
      transform: {
        client(args, opts) {
          args.generateSecret = authContract.clientSecret;
          if (stage.isProduction) {
            opts.retainOnDelete = true;
          }
        },
      },
    },
  );

  return { userPool, userPoolClient };
}

export type FoundationAuthentication = ReturnType<
  typeof createAuthentication
>;
