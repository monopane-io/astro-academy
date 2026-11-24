#!/usr/bin/env node
/**
 * One-time setup. Run it after putting MONOPANE_TENANT_ID and
 * MONOPANE_SETUP_API_KEY in .dev.vars:
 *
 *   npm run setup
 *
 * It does two things you would otherwise do by hand:
 *
 *   1. Creates the academy's own API key in Monopane, limited to the seven
 *      scopes the site uses. (The console creates unrestricted keys only, so
 *      the scoped key is made through the API with your setup key.)
 *   2. Generates SESSION_SECRET.
 *
 * Both are appended to .dev.vars for local development, and written with the
 * tenant ID to .prod.vars, ready for `npx wrangler secret bulk .prod.vars`.
 * Neither file is committed. Running it again changes nothing.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { client, createApiKey } from "@monopane/sdk";

const SCOPES = [
	"content:read",
	"learners:read",
	"learners:write",
	"enrollments:read",
	"enrollments:write",
	"progress:write",
	"analytics:read",
];

const tenantId = process.env.MONOPANE_TENANT_ID;
const setupKey = process.env.MONOPANE_SETUP_API_KEY;
const baseUrl = (process.env.MONOPANE_API_URL || "https://api.monopane.io").replace(/\/+$/, "");

if (!existsSync(".dev.vars")) {
	console.error(
		"There is no .dev.vars yet. Copy .dev.vars.example to .dev.vars and fill in the first two values.",
	);
	process.exit(1);
}
if (!tenantId || !setupKey) {
	console.error("Put MONOPANE_TENANT_ID and MONOPANE_SETUP_API_KEY in .dev.vars first.");
	process.exit(1);
}

let apiKey = process.env.MONOPANE_API_KEY;
let sessionSecret = process.env.SESSION_SECRET;
const added = [];

if (!apiKey) {
	client.setConfig({ baseUrl, auth: () => setupKey });
	const result = await createApiKey({
		path: { tenantId },
		body: { name: "Academy site", mode: "live", scopes: SCOPES },
	});
	if (!result.data) {
		const message = result.error?.error?.message ?? `HTTP ${result.response?.status ?? "error"}`;
		console.error(`Monopane would not create the academy's key: ${message}`);
		console.error("MONOPANE_SETUP_API_KEY must be an unrestricted key for MONOPANE_TENANT_ID.");
		process.exit(1);
	}
	apiKey = result.data.rawKey;
	appendFileSync(
		".dev.vars",
		`\n# The academy's own key (seven scopes). Created by npm run setup.\nMONOPANE_API_KEY=${apiKey}\n`,
	);
	added.push(`MONOPANE_API_KEY (new key "Academy site", scopes: ${SCOPES.join(", ")})`);
}

if (!sessionSecret) {
	sessionSecret = randomBytes(32).toString("hex");
	appendFileSync(".dev.vars", `SESSION_SECRET=${sessionSecret}\n`);
	added.push("SESSION_SECRET");
}

// Exactly what the deployed Worker needs, and nothing else: no setup key.
writeFileSync(
	".prod.vars",
	`MONOPANE_API_KEY=${apiKey}\nMONOPANE_TENANT_ID=${tenantId}\nSESSION_SECRET=${sessionSecret}\n`,
	{ mode: 0o600 },
);

console.log(
	added.length > 0
		? `Added to .dev.vars:\n  ${added.join("\n  ")}`
		: ".dev.vars already had MONOPANE_API_KEY and SESSION_SECRET; nothing was created.",
);
console.log("Wrote .prod.vars (the three secrets for the deployed site).");
console.log("Next: npm run seed, then npm run dev.");
