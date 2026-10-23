import type { APIRoute } from "astro";
import { z } from "zod";
import { json } from "../../../server/api";
import { unsubscribeFan } from "../../../server/fan-drops";
import { readFanJson, handleFanError } from "../../../server/fan-request";
import { requireSameOrigin } from "../../../server/request-security";
export const prerender = false;
export const POST: APIRoute = async ({ request }) => {
  try {
    requireSameOrigin(request);
    const { token } = z.object({ token: z.string().max(1024) }).strict().parse(await readFanJson(request));
    return json(await unsubscribeFan(token));
  } catch (error) { return handleFanError(error); }
};
