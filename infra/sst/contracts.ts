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
  readonly cors: false;
  readonly versioning: boolean;
  readonly expirationDays?: number;
}

export interface ApiRouteContract {
  readonly route: `GET /${string}`;
  readonly path: `/${string}`;
  readonly authorization: "none" | "cognito-jwt";
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
    fields: { id: "string", cognito_sub: "string" },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      byCognitoSubject: { hashKey: "cognito_sub" },
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
    cors: false,
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

export const authContract = {
  userPoolLogicalName: "UserPool",
  userPoolClientLogicalName: "UserPoolClient",
  authorizerName: "CognitoAuthorizer",
  signInAlias: "email",
  clientSecret: false,
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
  apiFunctions: 1,
  userPools: 1,
  userPoolClients: 1,
  jwtAuthorizers: 1,
} as const;

export const expectedOutputKeys = [
  "stage",
  "routerUrl",
  "siteUrl",
  "apiUrl",
  "apiId",
  "apiFunctionName",
  "routerDistributionId",
  "healthUrl",
  "protectedHealthUrl",
  "tableNames",
  "bucketNames",
  "userPoolId",
  "userPoolClientId",
  "testDeployRoleArn",
] as const;
