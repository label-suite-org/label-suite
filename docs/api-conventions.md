# Internal API Conventions

**Status:** `in_progress`  
**Tracking:** GitHub issue #43

## Scope

These conventions apply to internal JSON endpoints under `src/pages/api` and
mutation handlers under `src/pages/invite`.

The API serves Label Suite's Astro and React frontend. It is not currently a
versioned public integration API.

## Request lifecycle

Every request receives an application-generated correlation ID. The ID is:

- available as `Astro.locals.requestId`;
- retained across asynchronous server work;
- returned in the `X-Request-ID` response header;
- included as `request_id` in unexpected-error responses;
- written with server-side unexpected-error diagnostics.

Do not accept a caller-supplied request ID as authoritative.

## Read routes

A tenant-scoped read route must:

1. resolve the active organization with `requireOrgId(locals)`;
2. pass that organization ID to every domain query;
3. avoid using a client-supplied `org_id`;
4. return data through the shared `json()` helper.

Read access beyond ordinary workspace membership must use a named capability.

## Mutation routes

A mutation route must execute these steps in order:

1. pass the middleware's same-origin policy for unsafe `/api/*` methods;
2. require the narrowest named capability with `requireCapability`;
3. parse the body with `parseJson` and a Zod schema;
4. invoke one organization-scoped domain mutation;
5. write the domain audit/event record when required;
6. return through `json`;
7. translate failures through `handleApiError`.

Critical routes may repeat `requireSameOrigin` locally as defense in depth and
to preserve their contract when invoked directly in tests.

Native bearer routes resolve the authenticated actor with `resolveNativeActor`
and check the named capability using `hasCapability(actor.workspace.role, ...)`.
They do not use browser cookies or browser same-origin checks. Document each
native mutation in the route-policy inventory and test restricted-role rejection.

Broad role helpers are compatibility mechanisms, not the target convention.
New mutation routes must not use `requireMutateRole`.

## Error responses

Expected errors may return their safe domain message:

```json
{ "error": "Record not found" }
```

Unexpected errors return:

```json
{
  "error": "Internal server error",
  "request_id": "correlation-id"
}
```

Unexpected exception messages, database details, provider responses, filesystem
paths, environment values, and stack traces must never be sent to the browser.

## Tenant isolation

- Organization identity comes from the authenticated session and active workspace.
- IDs from route parameters or request bodies identify records, not organizations.
- Domain queries and mutations must constrain both record ID and organization ID.
- Storage keys must remain workspace-prefixed and authorization-checked.
- Tests for a tenant-scoped mutation must include a wrong-organization case.

## Response caching

Authenticated JSON responses use:

```text
Cache-Control: private, no-store
Vary: Cookie
X-Request-ID: <correlation-id>
```

Shared CDN caching is not permitted for authenticated API responses.
