import { awsClient } from "@/api/aws-client";

function unsupportedAgent(name) {
  return () => {
    throw new Error(`AWS agent is not migrated: ${name}`);
  };
}

export function createCompatibilityClient({ aws }) {
  return {
    entities: {
      Client: aws.entities.Client,
      Submission: aws.entities.Submission,
      User: aws.entities.User,
      PdfTemplate: aws.entities.PdfTemplate,
    },
    auth: aws.auth,
    users: aws.users,
    functions: aws.functions,
    connectors: aws.connectors,
    agents: {
      subscribeToConversation: unsupportedAgent("subscribeToConversation"),
      getConversation: unsupportedAgent("getConversation"),
      addMessage: unsupportedAgent("addMessage"),
    },
  };
}

export const base44 = createCompatibilityClient({ aws: awsClient });
