#!/usr/bin/env node
/**
 * Deploys this academy's build to Monopane hosting. Run by
 * .github/workflows/monopane.yml after `npm run build`, on every push:
 *
 *   node scripts/deploy.mjs
 *
 * 1. Asks GitHub Actions for an OIDC token for this job (the workflow needs
 *    `permissions: id-token: write`). The token says which repository, branch
 *    and commit the build comes from; no key or secret is kept in the repository.
 * 2. Sends it to Monopane, which finds the site connected to this repository
 *    and creates a deployment: production for the site's production branch,
 *    a preview for any other branch.
 * 3. Uploads dist/server (the Worker) and dist/client (the static files),
 *    with a manifest read from dist/server/wrangler.json.
 * 4. Prints the deployment's address.
 *
 * If the repository is not connected to a Monopane site, it says how to
 * connect it and exits successfully, so a copy deployed elsewhere does not
 * fail its builds. Any other problem fails the job with Monopane's message.
 *
 * Plain Node 22, no dependencies. MONOPANE_API_URL overrides the API address.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_API_URL = "https://api.monopane.io";
/** The audience Monopane accepts build tokens for, whatever API address is used. */
export const TOKEN_AUDIENCE = "https://api.monopane.io";

/** A problem to report to whoever reads the job's log. */
export class DeployError extends Error {}

/** Reads the manifest Monopane needs from the build's own Worker settings. */
export async function readManifest(serverDir) {
	const path = join(serverDir, "wrangler.json");
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		throw new DeployError(`${path} is missing. Run \`npm run build\` before deploying.`);
	}
	let config;
	try {
		config = JSON.parse(text);
	} catch {
		throw new DeployError(`${path} is not valid JSON.`);
	}
	return manifestFrom(config);
}

/** The upload's manifest from the build's Worker settings (dist/server/wrangler.json). */
export function manifestFrom(config) {
	if (!config || typeof config.main !== "string" || config.main === "") {
		throw new DeployError("The build's wrangler.json names no main module.");
	}
	if (typeof config.compatibility_date !== "string") {
		throw new DeployError("The build's wrangler.json has no compatibility_date.");
	}
	return {
		mainModule: posix.normalize(config.main.replace(/\\/g, "/")).replace(/^\.\//, ""),
		compatibilityDate: config.compatibility_date,
		compatibilityFlags: Array.isArray(config.compatibility_flags) ? config.compatibility_flags : [],
	};
}

/**
 * Whether a file stays out of the upload: local secrets (`.dev.vars`
 * anywhere), the build tool's settings file and its asset ignore list.
 */
export function isLeftOut(kind, path) {
	const name = path.slice(path.lastIndexOf("/") + 1);
	if (name === ".dev.vars" || name.startsWith(".dev.vars.")) return true;
	if (kind === "server" && path === "wrangler.json") return true;
	if (kind === "client" && path === ".assetsignore") return true;
	return false;
}

/** Every file under `dir`, as `<kind>/<path>` part names with `/` separators, sorted. */
export async function collectFiles(dir, kind) {
	const root = resolve(dir);
	const found = [];
	async function walk(relativeDir) {
		let entries;
		try {
			entries = await readdir(join(root, relativeDir), { withFileTypes: true });
		} catch {
			throw new DeployError(`${join(dir, relativeDir)} is missing. Run \`npm run build\` first.`);
		}
		for (const entry of entries) {
			const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile() && !isLeftOut(kind, path)) {
				found.push({ part: `${kind}/${path}`, file: join(root, path) });
			}
		}
	}
	await walk("");
	return found.sort((a, b) => (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
}

/** The upload body: the manifest, then one file part per file. */
export async function buildForm(manifest, files) {
	const form = new FormData();
	form.set("manifest", JSON.stringify(manifest));
	for (const { part, file } of files) {
		form.set(part, new Blob([await readFile(file)]), part.slice(part.lastIndexOf("/") + 1));
	}
	return form;
}

/** Monopane's error message from a response body, or a fallback naming the status. */
export function errorMessage(status, body) {
	const message = body?.error?.message;
	return typeof message === "string" && message
		? `Monopane answered ${status}: ${message}`
		: `Monopane answered ${status} with no explanation.`;
}

/** Whether Monopane said the repository is not connected to any site. */
export function isNotConnected(status, body) {
	return status === 404 && body?.error?.code === "REPOSITORY_NOT_CONNECTED";
}

/** A GitHub Actions annotation line. Newlines and `%` are escaped as the runner expects. */
export function annotation(kind, title, message) {
	const escapeData = (text) =>
		String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
	return `::${kind} title=${escapeData(title).replace(/:/g, "%3A").replace(/,/g, "%2C")}::${escapeData(message)}`;
}

/** The commit's message and author, from the push event GitHub gives the job. */
export async function commitDetails(env) {
	if (!env.GITHUB_EVENT_PATH) return {};
	try {
		const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
		const head = event?.head_commit;
		return {
			message: typeof head?.message === "string" ? head.message.slice(0, 10_000) : undefined,
			author: typeof head?.author?.name === "string" ? head.author.name.slice(0, 255) : undefined,
		};
	} catch {
		return {};
	}
}

async function readJson(response) {
	const text = await response.text();
	try {
		return text ? JSON.parse(text) : null;
	} catch {
		return null;
	}
}

/** This job's OIDC token from GitHub Actions, for Monopane. */
export async function requestToken(env, doFetch = fetch) {
	const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
	const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
	if (!url || !bearer) {
		throw new DeployError(
			"This job cannot get a GitHub OIDC token. The workflow needs `permissions: id-token: write`, and this script must run in GitHub Actions.",
		);
	}
	let response;
	try {
		response = await doFetch(`${url}&audience=${encodeURIComponent(TOKEN_AUDIENCE)}`, {
			headers: { Authorization: `bearer ${bearer}`, Accept: "application/json" },
		});
	} catch (error) {
		throw new DeployError(`Could not reach GitHub for an OIDC token: ${error?.message ?? error}`);
	}
	const body = await readJson(response);
	if (!response.ok || typeof body?.value !== "string") {
		throw new DeployError(`GitHub did not give this job an OIDC token (${response.status}).`);
	}
	return body.value;
}

/**
 * The whole deployment. Returns `{ deployed: false, message }` when the
 * repository is not connected, else `{ deployed: true, deployment }`.
 */
export async function deploy({
	env = process.env,
	doFetch = fetch,
	dist = "dist",
	log = console.log,
} = {}) {
	const apiUrl = (env.MONOPANE_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
	const token = await requestToken(env, doFetch);
	const call = async (url, init) => {
		try {
			return await doFetch(url, init);
		} catch (error) {
			throw new DeployError(`Could not reach Monopane at ${apiUrl}: ${error?.message ?? error}`);
		}
	};

	const created = await call(`${apiUrl}/github/deployments`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify(await commitDetails(env)),
	});
	const createdBody = await readJson(created);
	if (isNotConnected(created.status, createdBody)) {
		return { deployed: false, message: createdBody.error.message };
	}
	if (!created.ok) throw new DeployError(errorMessage(created.status, createdBody));
	const { deployment, uploadUrl, uploadToken } = createdBody;
	log(`Deployment ${deployment.id} (${deployment.target}) created. Uploading the build...`);

	const manifest = await readManifest(join(dist, "server"));
	const files = [
		...(await collectFiles(join(dist, "server"), "server")),
		...(await collectFiles(join(dist, "client"), "client")),
	];
	const uploaded = await call(`${apiUrl}${uploadUrl}`, {
		method: "POST",
		headers: { Authorization: `Bearer ${uploadToken}` },
		body: await buildForm(manifest, files),
	});
	const uploadedBody = await readJson(uploaded);
	if (!uploaded.ok) throw new DeployError(errorMessage(uploaded.status, uploadedBody));
	return { deployed: true, deployment: uploadedBody };
}

async function main() {
	try {
		const result = await deploy();
		if (!result.deployed) {
			console.log(
				annotation(
					"notice",
					"Not deployed to Monopane",
					`${result.message}\nIf you host this academy yourself, delete .github/workflows/monopane.yml to stop this step.`,
				),
			);
			return;
		}
		const { deployment } = result;
		const lines = [`Deployed: ${deployment.url}`];
		if (deployment.branchUrl) lines.push(`Latest on this branch: ${deployment.branchUrl}`);
		console.log(lines.join("\n"));
		console.log(annotation("notice", "Deployed to Monopane", lines.join("\n")));
		if (process.env.GITHUB_STEP_SUMMARY) {
			const { appendFile } = await import("node:fs/promises");
			await appendFile(
				process.env.GITHUB_STEP_SUMMARY,
				`### Deployed to Monopane\n\n${lines.map((line) => `- ${line}`).join("\n")}\n`,
			);
		}
	} catch (error) {
		const message =
			error instanceof DeployError ? error.message : `Unexpected error: ${error?.stack ?? error}`;
		console.error(annotation("error", "Monopane deployment failed", message));
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main();
}
