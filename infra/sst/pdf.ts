import { pdfContract } from "./contracts";
import type { StageSettings } from "./stage";

export function createPdfApi(
  stage: StageSettings,
  workloadBoundaryArn: $util.Input<string>,
  routerOrigin: $util.Input<string>,
) {
  const pdfFunction = new sst.aws.Function(pdfContract.functionLogicalName, {
    handler: pdfContract.handler,
    runtime: pdfContract.runtime,
    architecture: pdfContract.architecture,
    memory: `${pdfContract.memoryMb} MB`,
    timeout: `${pdfContract.timeoutSeconds / 60} minute`,
    storage: `${pdfContract.storageMb} MB`,
    logging: {
      format: "json",
      retention: stage.isProduction ? "1 month" : "2 weeks",
    },
    environment: {
      CORS_ORIGIN: routerOrigin,
    },
    nodejs: {
      install: [...pdfContract.nodejsInstall],
    },
    copyFiles: [
      {
        from: pdfContract.font.source,
        to: pdfContract.font.destination,
      },
    ],
    link: [...pdfContract.resourceLinks],
    permissions: [...pdfContract.permissions],
    transform: {
      role(args) {
        args.permissionsBoundary = workloadBoundaryArn;
      },
    },
  });

  const api = new sst.aws.ApiGatewayV2(pdfContract.apiLogicalName, {
    cors: pdfContract.apiCors,
    accessLog: {
      retention: stage.isProduction ? "1 month" : "2 weeks",
    },
  });

  for (const { route } of pdfContract.routes) {
    api.route(route, pdfFunction.arn);
  }

  return { api, pdfFunction };
}

export type FoundationPdf = ReturnType<typeof createPdfApi>;
