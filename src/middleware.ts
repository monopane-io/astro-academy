import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { type Config, SetupError, readConfig } from "./lib/config";
import { checkApiKey, configure } from "./lib/monopane";
import { SESSION_COOKIE, openSession } from "./lib/session";

/**
 * Runs before every page. It reads the settings, checks once that the API key
 * can do what the academy needs, and works out who is signed in. If the
 * academy is not set up correctly, every page says what is wrong instead of
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
		context.cookies.get(SESSION_COOKIE)?.value,
		config.sessionSecret,
	);
	return next();
});

function setupProblem(problems: string[]): Response {
	console.error(`Academy setup problem: ${problems.join(" ")}`);
	const items = problems.map((problem) => `<li>${problem.replace(/</g, "&lt;")}</li>`).join("");
	const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>This academy is not set up yet</title>
<style>body{font:1rem/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#16202b}code{background:#eef1f4;padding:.1em .3em;border-radius:3px}</style></head>
<body>
<h1>This academy is not set up yet</h1>
<p>The site cannot start until this is fixed:</p>
<ul>${items}</ul>
<p>Settings are listed in the README. Secrets are set with <code>npx wrangler secret put NAME</code>; for local development they go in <code>.dev.vars</code>.</p>
</body></html>`;
	return new Response(html, {
		status: 500,
		headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
	});
}
