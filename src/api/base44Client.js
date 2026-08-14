import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, functionsVersion, appBaseUrl } = appParams;

// For questionnaire page, don't pass any token so SDK won't attempt auth calls
const isQuestionnaire = typeof window !== 'undefined' && window.location.pathname.startsWith('/questionnaire');
const token = isQuestionnaire ? null : appParams.token;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});