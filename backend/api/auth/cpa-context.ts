import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { forbidden, unauthorized } from "../core/errors";
import {
  getBearerToken,
  getGatewayClaims,
  hasScope,
} from "../core/request-context";
import type { AccessTokenVerifier } from "./jwt";

export interface LinkedUser {
  readonly id: string;
  readonly role: string;
  readonly cognito_sub: string;
}

export interface SubjectUserLookup {
  findByCognitoSubject(subject: string): Promise<readonly LinkedUser[]>;
}

export interface CpaActor {
  readonly userId: string;
  readonly cognitoSubject: string;
  readonly role: "admin";
}

export async function resolveCpaActor(
  event: APIGatewayProxyEventV2,
  verifier: AccessTokenVerifier,
  users: SubjectUserLookup,
  requiredScope = "auditflow-api/cpa",
): Promise<CpaActor> {
  const gatewayClaims = getGatewayClaims(event);
  if (
    gatewayClaims.token_use !== "access" ||
    !hasScope(gatewayClaims.scope, requiredScope)
  ) {
    throw unauthorized();
  }
  let verified;
  try {
    verified = await verifier.verify(getBearerToken(event));
  } catch {
    throw unauthorized();
  }
  if (
    verified.sub !== gatewayClaims.sub ||
    !hasScope(verified.scope, requiredScope)
  ) {
    throw unauthorized();
  }
  const linkedUsers = await users.findByCognitoSubject(verified.sub);
  if (linkedUsers.length !== 1) throw forbidden();
  const user = linkedUsers[0];
  if (user.role !== "admin" || user.cognito_sub !== verified.sub) {
    throw forbidden();
  }
  return Object.freeze({
    userId: user.id,
    cognitoSubject: verified.sub,
    role: "admin" as const,
  });
}
