import type { APIRoute } from "astro";
import { executeOperatorDiagnostics } from "../../../../../../server/operator-diagnostics-execution";

export const prerender = false;

export const GET: APIRoute = ({ request }) => executeOperatorDiagnostics(request, {
  kind: "jobs_health",
});
