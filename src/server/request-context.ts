import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  operation: () => T,
): T {
  return requestContext.run(context, operation);
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function getOrCreateRequestId(): string {
  return getRequestId() ?? crypto.randomUUID();
}
