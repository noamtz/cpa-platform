import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { awsClient } from '@/api/aws-client';

const { appId, functionsVersion, appBaseUrl } = appParams;

// For questionnaire page, don't pass any token so SDK won't attempt auth calls
const isQuestionnaire = typeof window !== 'undefined' && window.location.pathname.startsWith('/questionnaire');
const token = isQuestionnaire ? null : appParams.token;

const legacyBase44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

export function createCompatibilityClient({ aws, legacy }) {
  return {
    entities: {
      Client: aws.entities.Client,
      Submission: aws.entities.Submission,
      User: aws.entities.User,
      PdfTemplate: {
        list: (...args) => legacy.entities.PdfTemplate.list(...args),
        create: (...args) => legacy.entities.PdfTemplate.create(...args),
        update: (...args) => legacy.entities.PdfTemplate.update(...args),
        delete: (...args) => legacy.entities.PdfTemplate.delete(...args),
      },
    },
    auth: aws.auth,
    users: aws.users,
    functions: {
      invoke: (name, payload) => {
        if (name === 'getActiveTemplate') {
          return legacy.functions.invoke(name, payload);
        }
        return aws.functions.invoke(name, payload);
      },
    },
    connectors: aws.connectors,
    integrations: {
      Core: {
        CreateFileSignedUrl: (...args) =>
          legacy.integrations.Core.CreateFileSignedUrl(...args),
      },
    },
    agents: {
      subscribe: (...args) => legacy.agents.subscribe(...args),
      get: (...args) => legacy.agents.get(...args),
      add: (...args) => legacy.agents.add(...args),
    },
  };
}

// Base44 remains available only through the explicit legacy allowlist above.
export const base44 = createCompatibilityClient({
  aws: awsClient,
  legacy: legacyBase44,
});
