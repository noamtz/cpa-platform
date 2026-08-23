import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { notFound } from "./errors";

export type RouteHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyStructuredResultV2>;

export class ApiRouter {
  private readonly routes = new Map<string, RouteHandler>();

  register(routeKey: string, handler: RouteHandler) {
    if (this.routes.has(routeKey)) {
      throw new Error(`Duplicate API route: ${routeKey}`);
    }
    this.routes.set(routeKey, handler);
    return this;
  }

  has(routeKey: string) {
    return this.routes.has(routeKey);
  }

  async dispatch(routeKey: string, event: APIGatewayProxyEventV2) {
    const handler = this.routes.get(routeKey);
    if (!handler) throw notFound();
    return handler(event);
  }
}
