import type { APIRoute } from "astro";
import { signOutResponse } from "../lib/pages";

export const POST: APIRoute = (context) => signOutResponse(context);
