import type { APIRoute } from "astro";
import { startSignIn } from "../../lib/admin/sign-in";

/** Sends the person to Monopane to sign in. They come back to /admin/callback. */
export const GET: APIRoute = async ({ locals, cookies, url, redirect }) =>
	redirect(await startSignIn(locals.config, cookies, url, url.searchParams.get("next")));
