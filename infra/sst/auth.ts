import { authContract } from "./contracts";
import { APP_NAME, AWS_REGION, type StageSettings } from "./stage";

export function createAuthentication(
  stage: StageSettings,
  routerUrl: $util.Input<string>,
) {
  const userPool = new sst.aws.CognitoUserPool(
    authContract.userPoolLogicalName,
    {
      usernames: [authContract.signInAlias],
      transform: {
        userPool(args, opts) {
          args.adminCreateUserConfig = {
            allowAdminCreateUserOnly: true,
          };
          if (stage.isProduction) {
            args.deletionProtection = "ACTIVE";
            opts.retainOnDelete = true;
          }
        },
      },
    },
    { retainOnDelete: stage.isProduction },
  );

  const resourceServer = new aws.cognito.ResourceServer(
    authContract.resourceServerLogicalName,
    {
      identifier: authContract.resourceServerIdentifier,
      name: authContract.resourceServerName,
      scopes: [
        {
          scopeName: authContract.scopeName,
          scopeDescription: authContract.scopeDescription,
        },
      ],
      userPoolId: userPool.id,
    },
    { retainOnDelete: stage.isProduction },
  );

  const domain = new aws.cognito.UserPoolDomain(
    authContract.userPoolDomainLogicalName,
    {
      domain: `${APP_NAME}-${stage.name}-login`,
      userPoolId: userPool.id,
    },
    { retainOnDelete: stage.isProduction },
  );

  const callbackUrl = $interpolate`${routerUrl}${authContract.callbackPath}`;
  const logoutUrl = $interpolate`${routerUrl}${authContract.logoutPath}`;
  const callbackUrls = stage.isProduction
    ? [callbackUrl]
    : [
        callbackUrl,
        `${authContract.localOrigin}${authContract.callbackPath}`,
      ];
  const logoutUrls = stage.isProduction
    ? [logoutUrl]
    : [logoutUrl, `${authContract.localOrigin}${authContract.logoutPath}`];

  const userPoolClient = userPool.addClient(
    authContract.userPoolClientLogicalName,
    {
      callbackUrls,
      transform: {
        client(args, opts) {
          args.generateSecret = authContract.clientSecret;
          args.allowedOauthFlows = [...authContract.allowedOAuthFlows];
          args.allowedOauthFlowsUserPoolClient = true;
          args.allowedOauthScopes = [...authContract.allowedOAuthScopes];
          args.callbackUrls = callbackUrls;
          args.defaultRedirectUri = callbackUrl;
          args.logoutUrls = logoutUrls;
          args.enableTokenRevocation = true;
          args.explicitAuthFlows = ["ALLOW_USER_SRP_AUTH"];
          args.preventUserExistenceErrors = "ENABLED";
          args.accessTokenValidity = 1;
          args.idTokenValidity = 1;
          args.refreshTokenValidity = authContract.refreshTokenValidityDays;
          args.tokenValidityUnits = {
            accessToken: "hours",
            idToken: "hours",
            refreshToken: "days",
          };
          opts.dependsOn = resourceServer;
          if (stage.isProduction) {
            opts.retainOnDelete = true;
          }
        },
      },
    },
  );

  const authority = $interpolate`https://cognito-idp.${AWS_REGION}.amazonaws.com/${userPool.id}`;

  return {
    userPool,
    userPoolClient,
    domain,
    resourceServer,
    authority,
    callbackUrl,
    logoutUrl,
    scope: authContract.allowedOAuthScopes.join(" "),
  };
}

export type FoundationAuthentication = ReturnType<
  typeof createAuthentication
>;
