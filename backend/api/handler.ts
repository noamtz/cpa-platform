import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { resolveCpaActor } from "./auth/cpa-context";
import { PublicClientAuthorizer } from "./auth/public-client";
import {
  getRuntimeAccessTokenVerifier,
  type AccessTokenVerifier,
} from "./auth/jwt";
import { ApiError, normalizeApiError } from "./core/errors";
import { errorResponse } from "./core/http";
import { getRequestId } from "./core/request-context";
import { ApiRouter } from "./core/router";
import { ClientRepository } from "./repositories/client";
import type { DynamoDocumentClient } from "./repositories/dynamo";
import { QuestionnaireTemplateRepository } from "./repositories/questionnaire-template";
import { PdfTemplateRepository } from "./repositories/pdf-template";
import { SubmissionRepository } from "./repositories/submission";
import { UserRepository } from "./repositories/user";
import { registerDeferredIntegrationRoutes } from "./routes/deferred-integrations";
import { registerCpaWorkflowRoutes } from "./routes/cpa-workflows";
import { registerEntityRoutes } from "./routes/entities";
import { registerFileRoutes } from "./routes/files";
import { healthResponse } from "./routes/health";
import { registerMeRoutes } from "./routes/me";
import { registerPublicQuestionnaireRoutes } from "./routes/public-questionnaire";
import { registerTemplateRoutes } from "./routes/templates";
import { registerUserRoutes } from "./routes/users";
import { ChangeJournalService } from "./services/change-journal";
import { CpaWorkflowService } from "./services/cpa-workflows";
import { EntityService } from "./services/entities";
import { FileService } from "./services/files";
import { PublicQuestionnaireService } from "./services/public-questionnaire";
import { TemplateService } from "./services/templates";
import { UserService, type CognitoAdminClient } from "./services/users";

type StageProvider = () => string;

export interface ApiDependencies {
  readonly verifier: AccessTokenVerifier;
  readonly users: UserRepository;
  readonly entities: EntityService;
  readonly publicQuestionnaire: PublicQuestionnaireService;
  readonly files: FileService;
  readonly userService: UserService;
  readonly templates?: TemplateService;
  readonly cpaWorkflows?: CpaWorkflowService;
}

type DependencyProvider = () => ApiDependencies;

const CPA_ROUTE_KEYS = new Set([
  "POST /cpa/clients/query",
  "POST /cpa/clients",
  "PATCH /cpa/clients/{id}",
  "POST /cpa/clients/{id}/token-rotation",
  "POST /cpa/submissions/query",
  "PATCH /cpa/submissions/{id}",
  "POST /cpa/users/query",
  "GET /cpa/me",
  "PATCH /cpa/me",
  "POST /cpa/users/invitations",
  "POST /cpa/integrations/google-drive/sync",
  "POST /cpa/integrations/google-drive/connect",
  "POST /cpa/integrations/google-drive/disconnect",
  "POST /cpa/integrations/telegram/notify",
  "POST /cpa/files/uploads/initiate",
  "POST /cpa/files/uploads/complete",
  "POST /cpa/files/submission-url",
  "POST /cpa/files/template-url",
  "POST /cpa/files/template-mirror",
  "POST /cpa/submissions/{id}/zip-downloads",
  "GET /cpa/submissions/{id}/zip-downloads/{jobId}",
  "GET /cpa/questionnaire-templates/active",
  "GET /cpa/questionnaire-templates",
  "GET /cpa/questionnaire-templates/{id}",
  "POST /cpa/questionnaire-templates",
  "GET /cpa/pdf-templates",
  "GET /cpa/pdf-templates/{id}",
  "POST /cpa/pdf-templates",
  "PATCH /cpa/pdf-templates/{id}",
  "POST /cpa/pdf-templates/{id}/archive",
  "POST /apps/{appId}/functions/cpaSaveSubmission",
  "POST /cpa/clients/{id}/tax-year",
  "POST /cpa/clients/{id}/orphan-status-reset",
  "POST /cpa/submissions/{id}/restore",
  "POST /cpa/submissions/{id}/workflow-status",
]);

const PUBLIC_FUNCTION_ROUTE_KEYS = new Set([
  "POST /apps/{appId}/functions/getClientByToken",
  "POST /apps/{appId}/functions/getActiveTemplate",
  "POST /apps/{appId}/functions/getTemplateById",
  "POST /apps/{appId}/functions/updateClientSubmission",
  "POST /apps/{appId}/functions/uploadFile",
  "POST /apps/{appId}/functions/getSignedPdfUrl",
  "POST /apps/{appId}/functions/getTemplateFileUrl",
  "POST /apps/{appId}/functions/getPdfTemplateById",
]);

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing runtime configuration: ${name}`);
  return value;
}

let runtimeDependencies: ApiDependencies | undefined;

export function createRuntimeDependencies(): ApiDependencies {
  if (runtimeDependencies) return runtimeDependencies;
  const sdkDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const documentClient: DynamoDocumentClient = {
    send(command) {
      return sdkDocumentClient.send(command as never);
    },
  };
  const sdkCognitoClient = new CognitoIdentityProviderClient({});
  const sdkS3Client = new S3Client({});
  const cognitoClient: CognitoAdminClient = {
    send(command) {
      return sdkCognitoClient.send(command as never);
    },
  };
  const clients = new ClientRepository(
    documentClient,
    requiredEnvironment("CLIENT_TABLE_NAME"),
  );
  const submissions = new SubmissionRepository(
    documentClient,
    requiredEnvironment("SUBMISSION_TABLE_NAME"),
  );
  const templates = new QuestionnaireTemplateRepository(
    documentClient,
    requiredEnvironment("QUESTIONNAIRE_TEMPLATE_TABLE_NAME"),
  );
  const pdfTemplates = new PdfTemplateRepository(
    documentClient,
    requiredEnvironment("PDF_TEMPLATE_TABLE_NAME"),
  );
  const users = new UserRepository(
    documentClient,
    requiredEnvironment("USER_TABLE_NAME"),
  );
  const journal = new ChangeJournalService({
    client: documentClient,
    tableName: requiredEnvironment("CHANGE_JOURNAL_TABLE_NAME"),
  });
  const publicAuthorizer = new PublicClientAuthorizer({ clients, submissions });
  const files = new FileService({
    s3: {
      send(command) {
        return sdkS3Client.send(command as never);
      },
    },
    presign(command, expiresIn, unhoistableHeaders) {
      return getSignedUrl(sdkS3Client, command as never, {
        expiresIn,
        ...(unhoistableHeaders ? { unhoistableHeaders } : {}),
      });
    },
    filesBucketName: requiredEnvironment("FILES_BUCKET_NAME"),
    temporaryOutputsBucketName: requiredEnvironment("TEMPORARY_OUTPUTS_BUCKET_NAME"),
    legacyFileReadsEnabled: process.env.LEGACY_FILE_READS_ENABLED === "true",
    clients,
    submissions,
    questionnaireTemplates: templates,
    pdfTemplates,
    publicAuthorizer,
    journal,
  });
  runtimeDependencies = {
    verifier: getRuntimeAccessTokenVerifier(),
    users,
    entities: new EntityService({ clients, submissions, journal }),
    publicQuestionnaire: new PublicQuestionnaireService({
      clients,
      submissions,
      templates,
      journal,
      authorizer: publicAuthorizer,
    }),
    files,
    userService: new UserService({
      users,
      journal,
      cognito: cognitoClient,
      userPoolId: requiredEnvironment("USER_POOL_ID"),
    }),
    templates: new TemplateService({
      questionnaireTemplates: templates,
      pdfTemplates,
      journal,
      files,
    }),
    cpaWorkflows: new CpaWorkflowService({
      clients,
      submissions,
      templates,
      journal,
    }),
  };
  return runtimeDependencies;
}

function resolveRouteKey(event: APIGatewayProxyEventV2): string | undefined {
  if (event.routeKey) return event.routeKey;
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || event.requestContext?.http?.path;
  return method && path ? `${method.toUpperCase()} ${path}` : undefined;
}

function createApiRouter(dependencies: ApiDependencies) {
  const router = new ApiRouter();
  const authenticated = (
    route: (
      event: APIGatewayProxyEventV2,
      actor: Awaited<ReturnType<typeof resolveCpaActor>>,
    ) => Promise<APIGatewayProxyStructuredResultV2>,
  ) =>
    async (event: APIGatewayProxyEventV2) => {
      const actor = await resolveCpaActor(
        event,
        dependencies.verifier,
        dependencies.users,
      );
      return route(event, actor);
    };

  registerEntityRoutes(router, dependencies.entities, authenticated);
  registerMeRoutes(router, dependencies.userService, authenticated);
  registerUserRoutes(router, dependencies.userService, authenticated);
  registerDeferredIntegrationRoutes(router, authenticated);
  registerPublicQuestionnaireRoutes(router, dependencies.publicQuestionnaire);
  registerFileRoutes(router, dependencies.files, authenticated);
  if (dependencies.templates) {
    registerTemplateRoutes(router, dependencies.templates, authenticated);
  }
  if (dependencies.cpaWorkflows) {
    registerCpaWorkflowRoutes(router, dependencies.cpaWorkflows, authenticated);
  }
  return router;
}

export function createHandler(
  getStage: StageProvider = () => process.env.AUDITFLOW_STAGE ?? "unknown",
  getDependencies: DependencyProvider = createRuntimeDependencies,
): APIGatewayProxyHandlerV2<APIGatewayProxyStructuredResultV2> {
  let router: ApiRouter | undefined;
  return async (event) => {
    try {
      const routeKey = resolveRouteKey(event);
      if (!routeKey) return errorResponse(400, "Invalid request");
      if (routeKey === "GET /health" || routeKey === "GET /auth/health") {
        return healthResponse(getStage());
      }
      if (
        !CPA_ROUTE_KEYS.has(routeKey) &&
        !PUBLIC_FUNCTION_ROUTE_KEYS.has(routeKey)
      ) {
        return errorResponse(404, "Not found");
      }
      if (!router) router = createApiRouter(getDependencies());
      if (!router.has(routeKey)) return errorResponse(404, "Not found");
      return await router.dispatch(routeKey, event);
    } catch (error) {
      const normalized = normalizeApiError(error);
      if (normalized.statusCode === 500) {
        console.error("AuditFlow API request failed", {
          requestId: getRequestId(event),
          errorName: error instanceof Error ? error.name : "UnknownError",
          message: "Unhandled API error",
        });
      }
      return errorResponse(
        normalized.statusCode,
        normalized.publicMessage,
        normalized.code,
        normalized.details?.reload === true ? true : undefined,
      );
    }
  };
}

export const handler = createHandler();

export { ApiError };
