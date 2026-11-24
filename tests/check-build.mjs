#!/usr/bin/env node
/**
 * Checks the built site (run `npm run build` first):
 *
 *   1. No API key is in anything that is built. The key is a runtime secret;
 *      it must not be baked into the Worker or its assets. If MONOPANE_API_KEY
 *      is set when this runs, its exact value is searched for too.
 *   2. Nothing a browser downloads (dist/client) mentions a key, the Monopane
 *      API or a quiz answer field.
 *   3. No JavaScript is shipped at all, so every page works as plain HTML.
 *      A site built on a UI library that runs in the browser turns this one
 *      check off with `"site": { "clientJavaScript": true }` in
 *      package.json; what it ships is still searched under 2.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const client = join(dist, "client");
const apiKey = process.env.MONOPANE_API_KEY ?? "";
const settings = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const allowClientJavaScript = settings.site?.clientJavaScript === true;

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

let all;
try {
	all = files(dist);
} catch {
	console.error("dist/ not found. Run `npm run build` first.");
	process.exit(1);
}

const problems = [];
const KEY_SHAPE = /mpk_(live|test)_[0-9a-f]{8,}/;
const CLIENT_FORBIDDEN = [
	"mpk_",
	"api.monopane.io",
	"MONOPANE_API_KEY",
	"correctAnswer",
	"acceptedAnswers",
	"acceptedPatterns",
];

for (const path of all) {
	const name = relative(dist, path);
	// The build copies .dev.vars next to the Worker so `astro preview` can run
	// with your local settings. It is not a module or an asset, so it is never
	// uploaded (`npx wrangler deploy --dry-run` lists what is), and dist/ is not
	// committed.
	if (/(^|\/)\.dev\.vars/.test(name)) continue;
	const text = readFileSync(path, "utf8");
	if (KEY_SHAPE.test(text)) problems.push(`${name} contains something shaped like an API key`);
	if (apiKey && text.includes(apiKey))
		problems.push(`${name} contains the value of MONOPANE_API_KEY`);

	if (path.startsWith(client)) {
		for (const word of CLIENT_FORBIDDEN) {
			if (text.includes(word)) problems.push(`${name} (sent to browsers) contains "${word}"`);
		}
		if (!allowClientJavaScript && /\.m?js$/.test(path))
			problems.push(`${name}: JavaScript is being sent to browsers`);
	}
}

if (problems.length > 0) {
	console.error(`Build check failed:\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
const clientCount = all.filter((path) => path.startsWith(client)).length;
console.log(
	`Build check passed: ${all.length} built files, ${clientCount} sent to browsers, no key${allowClientJavaScript ? "" : ", no client JavaScript"}.`,
);
