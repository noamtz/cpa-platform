import { CognitoJwtVerifier } from "aws-jwt-verify";

import { unauthorized } from "../core/errors";
import { hasScope } from "../core/request-context";

export interface VerifiedAccessToken {
  readonly sub: string;
  readonly clientId: string;
  readonly tokenUse: "access";
  readonly scope: string;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedAccessToken>;
}

export function createAccessTokenVerifier(
  userPoolId: string,
  clientId: string,
  requiredScope: string,
): AccessTokenVerifier {
  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: "access",
    clientId,
  });
  return {
    async verify(token) {
      try {
        const payload = await verifier.verify(token);
        if (
          payload.token_use !== "access" ||
          payload.client_id !== clientId ||
          typeof payload.sub !== "string" ||
          !hasScope(payload.scope, requiredScope)
        ) {
          throw unauthorized();
        }
        return {
          sub: payload.sub,
          clientId: payload.client_id,
          tokenUse: "access",
          scope: payload.scope,
        };
      } catch {
        throw unauthorized();
      }
    },
  };
}

let runtimeVerifier: AccessTokenVerifier | undefined;

export function getRuntimeAccessTokenVerifier() {
  if (!runtimeVerifier) {
    const userPoolId = process.env.USER_POOL_ID;
    const clientId = process.env.USER_POOL_CLIENT_ID;
    if (!userPoolId || !clientId) {
      throw new Error("Missing Cognito runtime configuration");
    }
    runtimeVerifier = createAccessTokenVerifier(
      userPoolId,
      clientId,
      "auditflow-api/cpa",
    );
  }
  return runtimeVerifier;
}
