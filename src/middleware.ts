import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { fromThisSite, isAdminPath, protectAdminReply } from "./lib/admin/pages";
import { adminCookieNames, openAdminSession } from "./lib/admin/session";
import { type Config, SetupError, readConfig } from "./lib/config";
import { checkApiKey, configure } from "./lib/monopane";
import { openSession, sessionCookieName } from "./lib/session";

/**
 * Runs before every page. It reads the settings, checks once that the API key
 * can do what the site needs, and works out who is signed in: the learner,
 * and separately the admin, if there is one. If the
 * site is not set up correctly, every page says what is wrong instead of
 * failing somewhere later.
 */
export const onRequest = defineMiddleware(async (context, next) => {
	let config: Config;
	try {
		config = readConfig(env as unknown as Record<string, unknown>);
		configure(config);
		await checkApiKey();
	} catch (error) {
		if (error instanceof SetupError) return setupProblem(error.problems);
		throw error;
	}

	context.locals.config = config;
	context.locals.user = await openSession(
		context.cookies.get(sessionCookieName(context.url))?.value,
		config.sessionSecret,
	);
	context.locals.admin = await openAdminSession(
		context.cookies.get(adminCookieNames(context.url).session)?.value,
		config.sessionSecret,
	);

	// The admin area: a form sent from anywhere but this site is refused, and
	// nothing it answers may be stored or shown inside another page.
	if (!isAdminPath(context.url.pathname)) return next();
	if (!fromThisSite(context.request, context.url)) {
		return new Response("This form was not sent from this site.", {
			status: 403,
			headers: { "Cache-Control": "no-store" },
		});
	}
	const response = await next();
	protectAdminReply(response.headers);
	return response;
});

function setupProblem(problems: string[]): Response {
	console.error(`Site setup problem: ${problems.join(" ")}`);
	const items = problems.map((problem) => `<li>${problem.replace(/</g, "&lt;")}</li>`).join("");
	const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>This site is not set up yet</title>
<style>body{font:1rem/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#16202b}code{background:#eef1f4;padding:.1em .3em;border-radius:3px}</style></head>
<body>
<h1>This site is not set up yet</h1>
<p>The site cannot start until this is fixed:</p>
<ul>${items}</ul>
<p>Settings are listed in the README. Secrets are set with <code>npx wrangler secret put NAME</code>; for local development they go in <code>.dev.vars</code>.</p>
</body></html>`;
	return new Response(html, {
		status: 500,
		headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
	});
}
