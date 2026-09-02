import type { StageName } from "./stage";

export type DynamoFieldType = "string" | "number" | "binary";

export interface DynamoIndexContract {
  readonly hashKey: string;
  readonly rangeKey?: string;
}

export interface TableContract {
  readonly logicalName: string;
  readonly entityName: string;
  readonly fields: Readonly<Record<string, DynamoFieldType>>;
  readonly primaryIndex: DynamoIndexContract;
  readonly globalIndexes: Readonly<Record<string, DynamoIndexContract>>;
}

export interface BucketContract {
  readonly logicalName: string;
  readonly publicAccess: false;
  readonly enforceHttps: true;
  readonly cors:
    | false
    | {
        readonly originPolicy: "router-plus-local-test";
        readonly allowHeaders: readonly string[];
        readonly allowMethods: readonly ("HEAD" | "PUT")[];
        readonly exposeHeaders: readonly string[];
        readonly maxAge: "1 hour";
      };
  readonly versioning: boolean;
  readonly expirationDays?: number;
}

export interface ApiRouteContract {
  readonly route: `${"GET" | "POST" | "PATCH"} /${string}`;
  readonly path: `/${string}`;
  readonly authorization: "none" | "cognito-jwt";
  readonly authorizationScopes?: readonly string[];
}

export interface PdfRouteContract {
  readonly route: `${"GET" | "POST" | "OPTIONS"} /${string}`;
}

export const tableContracts = [
  {
    logicalName: "ClientTable",
    entityName: "Client",
    fields: { id: "string", record_type: "string", created_date: "string" },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      byCreatedDate: { hashKey: "record_type", rangeKey: "created_date" },
    },
  },
  {
    logicalName: "SubmissionTable",
    entityName: "Submission",
    fields: {
      id: "string",
      client_id: "string",
      tax_year: "number",
      record_type: "string",
      created_date: "string",
    },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      byClientYear: { hashKey: "client_id", rangeKey: "tax_year" },
      byCreatedDate: { hashKey: "record_type", rangeKey: "created_date" },
    },
  },
  {
    logicalName: "QuestionnaireTemplateTable",
    entityName: "QuestionnaireTemplate",
    fields: { id: "string", record_type: "string", version: "number" },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      byVersion: { hashKey: "record_type", rangeKey: "version" },
    },
  },
  {
    logicalName: "PdfTemplateTable",
    entityName: "PdfTemplate",
    fields: { id: "string", record_type: "string", created_date: "string" },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      byCreatedDate: { hashKey: "record_type", rangeKey: "created_date" },
    },
  },
  {
    logicalName: "SyncedDriveFileTable",
    entityName: "SyncedDriveFile",
    fields: { id: "string", submission_id: "string", created_date: "string" },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      bySubmission: { hashKey: "submission_id", rangeKey: "created_date" },
    },
  },
  {
    logicalName: "UserTable",
    entityName: "User",
    fields: {
      id: "string",
      cognito_sub: "string",
      record_type: "string",
      created_date: "string",
    },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      byCognitoSubject: { hashKey: "cognito_sub" },
      byCreatedDate: { hashKey: "record_type", rangeKey: "created_date" },
    },
  },
  {
    logicalName: "ChangeJournalTable",
    entityName: "ChangeJournal",
    fields: { scope: "string", sequence: "string", entity_key: "string" },
    primaryIndex: { hashKey: "scope", rangeKey: "sequence" },
    globalIndexes: {
      byEntity: { hashKey: "entity_key", rangeKey: "sequence" },
    },
  },
] as const satisfies readonly TableContract[];

export const bucketContracts = [
  {
    logicalName: "FilesBucket",
    publicAccess: false,
    enforceHttps: true,
    cors: {
      originPolicy: "router-plus-local-test",
      allowHeaders: [
        "content-type",
        "if-none-match",
        "x-amz-meta-owner-hash",
        "x-amz-meta-purpose",
        "x-amz-meta-declared-size",
      ],
      allowMethods: ["PUT", "HEAD"],
      exposeHeaders: ["etag", "x-amz-version-id"],
      maxAge: "1 hour",
    },
    versioning: true,
  },
  {
    logicalName: "TemporaryOutputsBucket",
    publicAccess: false,
    enforceHttps: true,
    cors: false,
    versioning: false,
    expirationDays: 1,
  },
] as const satisfies readonly BucketContract[];

export const apiRoutes = {
  health: {
    route: "GET /health",
    path: "/health",
    authorization: "none",
  },
  protectedHealth: {
    route: "GET /auth/health",
    path: "/auth/health",
    authorization: "cognito-jwt",
  },
  publicGetClientByToken: {
    route: "POST /apps/{appId}/functions/getClientByToken",
    path: "/apps/{appId}/functions/getClientByToken",
    authorization: "none",
  },
  publicGetActiveTemplate: {
    route: "POST /apps/{appId}/functions/getActiveTemplate",
    path: "/apps/{appId}/functions/getActiveTemplate",
    authorization: "none",
  },
  publicGetTemplateById: {
    route: "POST /apps/{appId}/functions/getTemplateById",
    path: "/apps/{appId}/functions/getTemplateById",
    authorization: "none",
  },
  publicUpdateClientSubmission: {
    route: "POST /apps/{appId}/functions/updateClientSubmission",
    path: "/apps/{appId}/functions/updateClientSubmission",
    authorization: "none",
  },
  publicUploadFile: {
    route: "POST /apps/{appId}/functions/uploadFile",
    path: "/apps/{appId}/functions/uploadFile",
    authorization: "none",
  },
  publicGetSignedPdfUrl: {
    route: "POST /apps/{appId}/functions/getSignedPdfUrl",
    path: "/apps/{appId}/functions/getSignedPdfUrl",
    authorization: "none",
  },
  publicGetTemplateFileUrl: {
    route: "POST /apps/{appId}/functions/getTemplateFileUrl",
    path: "/apps/{appId}/functions/getTemplateFileUrl",
    authorization: "none",
  },
  publicGetPdfTemplateById: {
    route: "POST /apps/{appId}/functions/getPdfTemplateById",
    path: "/apps/{appId}/functions/getPdfTemplateById",
    authorization: "none",
  },
  clientQuery: {
    route: "POST /cpa/clients/query",
    path: "/cpa/clients/query",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  clientCreate: {
    route: "POST /cpa/clients",
    path: "/cpa/clients",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  clientUpdate: {
    route: "PATCH /cpa/clients/{id}",
    path: "/cpa/clients/{id}",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  clientTokenRotation: {
    route: "POST /cpa/clients/{id}/token-rotation",
    path: "/cpa/clients/{id}/token-rotation",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  submissionQuery: {
    route: "POST /cpa/submissions/query",
    path: "/cpa/submissions/query",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  submissionUpdate: {
    route: "PATCH /cpa/submissions/{id}",
    path: "/cpa/submissions/{id}",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  fileUploadInitiate: {
    route: "POST /cpa/files/uploads/initiate",
    path: "/cpa/files/uploads/initiate",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  fileUploadComplete: {
    route: "POST /cpa/files/uploads/complete",
    path: "/cpa/files/uploads/complete",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  submissionFileUrl: {
    route: "POST /cpa/files/submission-url",
    path: "/cpa/files/submission-url",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  templateFileUrl: {
    route: "POST /cpa/files/template-url",
    path: "/cpa/files/template-url",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  templateFileMirror: {
    route: "POST /cpa/files/template-mirror",
    path: "/cpa/files/template-mirror",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  submissionZipRequest: {
    route: "POST /cpa/submissions/{id}/zip-downloads",
    path: "/cpa/submissions/{id}/zip-downloads",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  submissionZipStatus: {
    route: "GET /cpa/submissions/{id}/zip-downloads/{jobId}",
    path: "/cpa/submissions/{id}/zip-downloads/{jobId}",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  userQuery: {
    route: "POST /cpa/users/query",
    path: "/cpa/users/query",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  me: {
    route: "GET /cpa/me",
    path: "/cpa/me",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  meUpdate: {
    route: "PATCH /cpa/me",
    path: "/cpa/me",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  userInvitation: {
    route: "POST /cpa/users/invitations",
    path: "/cpa/users/invitations",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  googleDriveSync: {
    route: "POST /cpa/integrations/google-drive/sync",
    path: "/cpa/integrations/google-drive/sync",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  googleDriveConnect: {
    route: "POST /cpa/integrations/google-drive/connect",
    path: "/cpa/integrations/google-drive/connect",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  googleDriveDisconnect: {
    route: "POST /cpa/integrations/google-drive/disconnect",
    path: "/cpa/integrations/google-drive/disconnect",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
  telegramNotify: {
    route: "POST /cpa/integrations/telegram/notify",
    path: "/cpa/integrations/telegram/notify",
    authorization: "cognito-jwt",
    authorizationScopes: ["auditflow-api/cpa"],
  },
} as const satisfies Readonly<Record<string, ApiRouteContract>>;

export const routerContract = {
  logicalName: "ApplicationRouter",
  apiPrefix: "/api",
  apiPattern: "/api/*",
  rewritePattern: "^/api/(.*)$",
  rewriteReplacement: "/$1",
  staticSiteLogicalName: "ApplicationSite",
  spaFallback: "index.html",
} as const;

export const pdfContract = {
  apiLogicalName: "PdfApi",
  functionLogicalName: "PdfRendererFunction",
  handler: "lambda/pdf-generator/index.handler",
  runtime: "nodejs20.x",
  architecture: "arm64",
  memoryMb: 1024,
  timeoutSeconds: 60,
  storageMb: 512,
  corsOriginPolicy: "router-origin-exact",
  apiCors: false,
  routerPrefix: "/pdf",
  routerPattern: "/pdf/*",
  rewritePattern: "^/pdf/(.*)$",
  rewriteReplacement: "/$1",
  routes: [
    { route: "GET /health" },
    { route: "POST /render-pages" },
    { route: "POST /generate-pdf" },
    { route: "OPTIONS /{proxy+}" },
  ] as const satisfies readonly PdfRouteContract[],
  nodejsInstall: [
    "@napi-rs/canvas",
    "@napi-rs/canvas-linux-arm64-gnu",
    "pdfjs-dist",
  ] as const,
  font: {
    source: "lambda/pdf-generator/fonts/Heebo-Regular.ttf",
    destination: "fonts/Heebo-Regular.ttf",
    bytes: 122012,
    sha256:
      "18F930B583FA8FE6B40B2F8263B7AC6AFBAC07ADC91A12467874E7467D3ACE30",
  },
  resourceLinks: [] as const,
  permissions: [] as const,
} as const;

export const zipWorkerContract = {
  logicalName: "ZipDownloadWorker",
  handler: "backend/api/workers/zip-download.handler",
  runtime: "nodejs20.x",
  architecture: "arm64",
  memoryMb: 1024,
  timeoutSeconds: 900,
  storageMb: 2048,
  processingLease: {
    prefix: "zip-jobs/locks/",
    durationSeconds: 60,
    heartbeatSeconds: 20,
    conditionalWrite: true,
    recoverableTakeover: true,
    resultOwnership: "job-and-owner",
    terminalStatusStorage: "lease-record",
    terminalStatusFenced: true,
  },
  permissions: {
    filesActions: ["s3:GetObject"] as const,
    temporaryActions: [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ] as const,
    temporaryPrefix: "zip-jobs/*",
  },
  notification: {
    name: "ZipDownloadRequests",
    bucketLogicalName: "TemporaryOutputsBucket",
    events: ["s3:ObjectCreated:*"] as const,
    filterPrefix: "zip-jobs/requests/",
    filterSuffix: ".json",
  },
} as const;

export const authContract = {
  userPoolLogicalName: "UserPool",
  userPoolClientLogicalName: "UserPoolClient",
  userPoolDomainLogicalName: "UserPoolDomain",
  resourceServerLogicalName: "CpaResourceServer",
  authorizerName: "CognitoAuthorizer",
  authorityType: "regional-user-pool-issuer",
  signInAlias: "email",
  clientSecret: false,
  resourceServerIdentifier: "auditflow-api",
  resourceServerName: "AuditFlow API",
  scopeName: "cpa",
  scopeDescription: "Access the CPA compatibility API",
  apiScope: "auditflow-api/cpa",
  allowedOAuthFlows: ["code"],
  allowedOAuthScopes: ["openid", "auditflow-api/cpa"],
  callbackPath: "/auth/callback",
  logoutPath: "/",
  localOrigin: "http://localhost:5173",
  refreshTokenValidityDays: 30,
  refreshTokenRotation: {
    feature: "ENABLED",
    retryGracePeriodSeconds: 10,
    providerCompatibility: "post-deploy-sdk-update",
  },
} as const;

export const deploymentContract = {
  roleLogicalName: "TestDeployRole",
  workloadBoundaryLogicalName: "WorkloadPermissionsBoundary",
  providerUrl: "token.actions.githubusercontent.com",
  audience: "sts.amazonaws.com",
  subject:
    "repo:noamtz@2631641/cpa-platform@1332935468:environment:test",
  repository: "noamtz/cpa-platform",
  environment: "test",
} as const;

export const deploymentGateContract = {
  privateFilesImport: {
    issue: 11,
    evidencePath: "docs/migration/private-file-import-verification.json",
    verifier: "tooling/verify_private_file_cutover.mjs",
    requiredBefore: "legacy-file-read-enablement",
    resolverContract: "legacy-sha256-v1",
    environmentVariable: "LEGACY_FILE_READS_ENABLED",
    syntheticOnlyValue: "false",
    enablementIssue: 11,
  },
} as const;

export const costContract = {
  logicalName: "ProductionMonthlyBudget",
  stage: "production" satisfies StageName,
  timeUnit: "MONTHLY",
  budgetType: "COST",
  notificationType: "ACTUAL",
  thresholdPercent: 80,
  automatedActions: false,
} as const;

export const expectedInventory = {
  tables: 7,
  buckets: 2,
  routers: 1,
  staticSites: 1,
  apis: 1,
  pdfApis: 1,
  apiFunctions: 1,
  pdfFunctions: 1,
  workerFunctions: 1,
  userPools: 1,
  userPoolClients: 1,
  userPoolDomains: 1,
  resourceServers: 1,
  jwtAuthorizers: 1,
} as const;

export const expectedOutputKeys = [
  "stage",
  "routerUrl",
  "siteUrl",
  "apiUrl",
  "apiId",
  "apiFunctionName",
  "pdfApiUrl",
  "pdfApiId",
  "pdfFunctionName",
  "pdfBaseUrl",
  "pdfHealthUrl",
  "zipWorkerFunctionName",
  "routerDistributionId",
  "healthUrl",
  "protectedHealthUrl",
  "tableNames",
  "bucketNames",
  "userPoolId",
  "userPoolClientId",
  "authAuthority",
  "authCallbackUrl",
  "authLogoutUrl",
  "authScope",
  "testDeployRoleArn",
] as const;
