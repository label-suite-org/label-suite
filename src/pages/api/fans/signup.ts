import type { APIRoute } from "astro";
import { z } from "zod";
import { runWithDatabaseContext } from "../../../lib/db";
import { json } from "../../../server/api";
import { fanId, fanSignupSchema } from "../../../server/fan-drops-core";
import { signupToFanDrop } from "../../../server/fan-drops";
import { readFanJson, handleFanError } from "../../../server/fan-request";
import { requireSameOrigin } from "../../../server/request-security";
const schema = z.object({ org: fanId, slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100), signup: fanSignupSchema }).strict();
export const prerender = false;
export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    requireSameOrigin(request);
    const input = schema.parse(await readFanJson(request));
    return json(await runWithDatabaseContext({ userId: "fan-public", orgId: input.org }, () => signupToFanDrop(input.org, input.slug, input.signup, clientAddress)));
  } catch (error) { return handleFanError(error); }
};
