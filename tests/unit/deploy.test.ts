import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	DeployError,
	annotation,
	buildForm,
	collectFiles,
	deploy,
	errorMessage,
	isLeftOut,
	isNotConnected,
	manifestFrom,
	readManifest,
	requestToken,
} from "../../scripts/deploy.mjs";

let dist: string;

function put(path: string, content: string) {
	const full = join(dist, path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
}

beforeAll(() => {
	dist = mkdtempSync(join(tmpdir(), "deploy-test-"));
	put(
		"server/wrangler.json",
		JSON.stringify({
			main: "entry.mjs",
			compatibility_date: "2026-11-01",
			compatibility_flags: ["nodejs_compat"],
			vars: { AUTH_MODE: "demo" },
		}),
	);
	put("server/entry.mjs", "export default {};");
	put("server/chunks/page.mjs", "export const page = 1;");
	put("server/.dev.vars", "SESSION_SECRET=local");
	put("client/_astro/site.css", "body{}");
	put("client/favicon.svg", "<svg/>");
	put("client/_headers", "/_astro/*\n  Cache-Control: immutable\n");
	put("client/.assetsignore", "_worker.js");
});

afterAll(() => {
	rmSync(dist, { recursive: true, force: true });
});

describe("the manifest", () => {
	it("comes from the build's Worker settings", async () => {
		expect(await readManifest(join(dist, "server"))).toEqual({
			mainModule: "entry.mjs",
			compatibilityDate: "2026-11-01",
			compatibilityFlags: ["nodejs_compat"],
		});
	});

	it("normalizes the main module's path and defaults the flags", () => {
		expect(manifestFrom({ main: "./entry.mjs", compatibility_date: "2026-11-01" })).toEqual({
			mainModule: "entry.mjs",
			compatibilityDate: "2026-11-01",
			compatibilityFlags: [],
		});
	});

	it("says what is wrong with a missing or incomplete build", async () => {
		expect(() => manifestFrom({ compatibility_date: "2026-11-01" })).toThrow(/no main module/);
		expect(() => manifestFrom({ main: "entry.mjs" })).toThrow(/compatibility_date/);
		await expect(readManifest(join(dist, "nowhere"))).rejects.toThrow(/npm run build/);
	});
});

describe("the files", () => {
	it("are every file of the build, as part names, without local secrets or tool files", async () => {
		const server = await collectFiles(join(dist, "server"), "server");
		const client = await collectFiles(join(dist, "client"), "client");
		expect(server.map((f: { part: string }) => f.part)).toEqual([
			"server/chunks/page.mjs",
			"server/entry.mjs",
		]);
		expect(client.map((f: { part: string }) => f.part)).toEqual([
			"client/_astro/site.css",
			"client/_headers",
			"client/favicon.svg",
		]);
	});

	it("leaves out .dev.vars anywhere, wrangler.json and .assetsignore", () => {
		expect(isLeftOut("server", ".dev.vars")).toBe(true);
		expect(isLeftOut("client", "nested/.dev.vars.production")).toBe(true);
		expect(isLeftOut("server", "wrangler.json")).toBe(true);
		expect(isLeftOut("server", "chunks/wrangler.json")).toBe(false);
		expect(isLeftOut("client", ".assetsignore")).toBe(true);
		expect(isLeftOut("client", "favicon.svg")).toBe(false);
	});

	it("says to build first when a directory is missing", async () => {
		await expect(collectFiles(join(dist, "missing"), "client")).rejects.toBeInstanceOf(DeployError);
	});

	it("go into one multipart body with the manifest", async () => {
		const files = await collectFiles(join(dist, "server"), "server");
		const form = await buildForm({ mainModule: "entry.mjs" }, files);
		expect(form.get("manifest")).toBe('{"mainModule":"entry.mjs"}');
		const entry = form.get("server/entry.mjs") as File;
		expect(await entry.text()).toBe("export default {};");
		expect([...form.keys()]).toEqual(["manifest", "server/chunks/page.mjs", "server/entry.mjs"]);
	});
});

describe("messages", () => {
	it("passes Monopane's own message on", () => {
		expect(errorMessage(422, { error: { message: "The build has no server/ files" } })).toBe(
			"Monopane answered 422: The build has no server/ files",
		);
		expect(errorMessage(502, null)).toBe("Monopane answered 502 with no explanation.");
	});

	it("knows an unconnected repository from any other 404", () => {
		expect(isNotConnected(404, { error: { code: "REPOSITORY_NOT_CONNECTED" } })).toBe(true);
		expect(isNotConnected(404, { error: { code: "NOT_FOUND" } })).toBe(false);
		expect(isNotConnected(401, { error: { code: "REPOSITORY_NOT_CONNECTED" } })).toBe(false);
	});

	it("writes annotations the runner can read", () => {
		expect(annotation("error", "Failed: a, b", "50% done\nnext")).toBe(
			"::error title=Failed%3A a%2C b::50%25 done%0Anext",
		);
	});

	it("explains a job without an OIDC token", async () => {
		await expect(requestToken({})).rejects.toThrow(/id-token: write/);
	});
});

/** A fetch that answers each URL from a handler and records what it was sent. */
function fakeFetch(handlers: Record<string, (init: RequestInit) => Response>) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
		const url = String(input);
		calls.push({ url, init });
		const handler = Object.entries(handlers).find(([prefix]) => url.startsWith(prefix))?.[1];
		if (!handler) throw new TypeError("fetch failed");
		return handler(init);
	}) as typeof fetch;
	return { fn, calls };
}

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ENV = {
	ACTIONS_ID_TOKEN_REQUEST_URL: "https://runner.example.test/token?api-version=2.0",
	ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token",
	MONOPANE_API_URL: "https://api.example.test/",
};

describe("a deployment", () => {
	it("gets a token, asks for a deployment, uploads the build and returns it", async () => {
		const deployment = { id: "dpl_1", target: "preview", url: "https://a-1.monopane.dev" };
		const { fn, calls } = fakeFetch({
			"https://runner.example.test/": () => json(200, { value: "oidc-token" }),
			"https://api.example.test/github/deployments": () =>
				json(201, {
					deployment,
					uploadUrl: "/tenants/t/sites/s/deployments/dpl_1/upload",
					uploadToken: "mpu_x",
				}),
			"https://api.example.test/tenants/": () => json(200, { ...deployment, status: "ready" }),
		});
		const result = await deploy({ env: ENV, doFetch: fn, dist, log: () => {} });
		expect(result).toEqual({ deployed: true, deployment: { ...deployment, status: "ready" } });

		expect(calls[0]?.url).toBe(
			"https://runner.example.test/token?api-version=2.0&audience=https%3A%2F%2Fapi.monopane.io",
		);
		expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
			"bearer runner-token",
		);
		expect((calls[1]?.init.headers as Record<string, string>).Authorization).toBe(
			"Bearer oidc-token",
		);
		const upload = calls[2];
		expect(upload?.url).toBe("https://api.example.test/tenants/t/sites/s/deployments/dpl_1/upload");
		expect((upload?.init.headers as Record<string, string>).Authorization).toBe("Bearer mpu_x");
		const form = upload?.init.body as FormData;
		expect(JSON.parse(form.get("manifest") as string)).toMatchObject({ mainModule: "entry.mjs" });
		expect(form.has("server/entry.mjs")).toBe(true);
		expect(form.has("server/.dev.vars")).toBe(false);
		expect(form.has("client/favicon.svg")).toBe(true);
	});

	it("does nothing, successfully, for a repository not connected to a site", async () => {
		const { fn, calls } = fakeFetch({
			"https://runner.example.test/": () => json(200, { value: "oidc-token" }),
			"https://api.example.test/github/deployments": () =>
				json(404, {
					error: { code: "REPOSITORY_NOT_CONNECTED", message: "Connect it in Monopane." },
				}),
		});
		const result = await deploy({ env: ENV, doFetch: fn, dist, log: () => {} });
		expect(result).toEqual({ deployed: false, message: "Connect it in Monopane." });
		expect(calls).toHaveLength(2);
	});

	it("fails with Monopane's message", async () => {
		const { fn } = fakeFetch({
			"https://runner.example.test/": () => json(200, { value: "oidc-token" }),
			"https://api.example.test/github/deployments": () =>
				json(201, {
					deployment: { id: "d", target: "production" },
					uploadUrl: "/tenants/u",
					uploadToken: "t",
				}),
			"https://api.example.test/tenants/": () =>
				json(413, {
					error: { code: "PAYLOAD_TOO_LARGE", message: "A build may be at most 25 MB" },
				}),
		});
		await expect(deploy({ env: ENV, doFetch: fn, dist, log: () => {} })).rejects.toThrow(
			"Monopane answered 413: A build may be at most 25 MB",
		);
	});

	it("says when Monopane cannot be reached", async () => {
		const { fn } = fakeFetch({
			"https://runner.example.test/": () => json(200, { value: "oidc-token" }),
		});
		await expect(deploy({ env: ENV, doFetch: fn, dist, log: () => {} })).rejects.toThrow(
			/Could not reach Monopane at https:\/\/api.example.test/,
		);
	});
});
