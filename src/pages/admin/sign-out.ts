import type { APIRoute } from "astro";
import { signOutAdmin } from "../../lib/admin/sign-in";

export const POST: APIRoute = async ({ locals, cookies, url, redirect }) => {
	await signOutAdmin(locals.config, cookies, url, locals.admin);
	return redirect("/", 303);
};
