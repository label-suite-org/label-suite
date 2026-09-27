import type { APIRoute } from "astro";
import { executeOperatorDiagnostics } from "../../../../../server/operator-diagnostics-execution";

export const prerender = false;

export const GET: APIRoute = ({ request, url }) => executeOperatorDiagnostics(request, {
  kind: "operations_brief",
  searchParams: url.searchParams,
});
