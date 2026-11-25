/**
 * The site's settings, read from the Worker's environment.
 *
 * Three are required: MONOPANE_API_KEY, MONOPANE_TENANT_ID and SESSION_SECRET.
 * This file has no imports on purpose, so it can be tested anywhere.
 */

export type AuthMode = "demo" | "magic-link";

/** Who sends the sign-in email: your own Resend account, or Monopane when it hosts the site. */
export type EmailVia = "resend" | "monopane";

export interface Config {
	apiKey: string;
	tenantId: string;
	sessionSecret: string;
	/** Monopane environment the site reads from. */
	environment: string;
	apiUrl: string;
	authMode: AuthMode;
	siteName: string;
	/** One line under the site name on the home page. */
	tagline: string;
	emailVia: EmailVia;
	resendApiKey: string | null;
	emailFrom: string | null;
}

/** Thrown when the site cannot run as configured. `problems` are safe to show. */
export class SetupError extends Error {
	constructor(readonly problems: string[]) {
		super(problems.join(" "));
		this.name = "SetupError";
	}
}

type RawEnv = Record<string, unknown>;

function text(env: RawEnv, name: string): string {
	const value = env[name];
	return typeof value === "string" ? value.trim() : "";
}

export function readConfig(env: RawEnv): Config {
	const problems: string[] = [];

	const apiKey = text(env, "MONOPANE_API_KEY");
	if (!apiKey) problems.push("MONOPANE_API_KEY is not set.");

	const tenantId = text(env, "MONOPANE_TENANT_ID");
	if (!tenantId) problems.push("MONOPANE_TENANT_ID is not set.");

	const sessionSecret = text(env, "SESSION_SECRET");
	if (!sessionSecret) problems.push("SESSION_SECRET is not set.");
	else if (sessionSecret.length < 32) {
		problems.push("SESSION_SECRET is too short. Use at least 32 random characters.");
	}

	const rawMode = text(env, "AUTH_MODE") || "demo";
	if (rawMode !== "demo" && rawMode !== "magic-link") {
		problems.push(`AUTH_MODE is "${rawMode}". Use "demo" or "magic-link".`);
	}
	const authMode: AuthMode = rawMode === "magic-link" ? "magic-link" : "demo";

	const resendApiKey = text(env, "RESEND_API_KEY") || null;
	const emailFrom = text(env, "EMAIL_FROM") || null;
	// With a Resend account of your own, that is what sends. EMAIL_VIA=monopane
	// is set for you when Monopane hosts the site and you have none.
	const rawVia = text(env, "EMAIL_VIA");
	if (rawVia && rawVia !== "resend" && rawVia !== "monopane") {
		problems.push(`EMAIL_VIA is "${rawVia}". Use "resend" or "monopane".`);
	}
	const emailVia: EmailVia =
		rawVia === "monopane" && !resendApiKey && !emailFrom ? "monopane" : "resend";
	if (authMode === "magic-link" && emailVia === "resend") {
		if (!resendApiKey) problems.push("AUTH_MODE is magic-link but RESEND_API_KEY is not set.");
		if (!emailFrom) problems.push("AUTH_MODE is magic-link but EMAIL_FROM is not set.");
	}
	if (authMode === "magic-link") {
		if (!env.MAGIC_LINKS) {
			problems.push("AUTH_MODE is magic-link but the MAGIC_LINKS KV binding is missing.");
		}
	}

	if (problems.length > 0) throw new SetupError(problems);

	return {
		apiKey,
		tenantId,
		sessionSecret,
		environment: text(env, "MONOPANE_ENVIRONMENT") || "production",
		apiUrl: (text(env, "MONOPANE_API_URL") || "https://api.monopane.io").replace(/\/+$/, ""),
		authMode,
		siteName: text(env, "SITE_NAME") || "Site",
		tagline: text(env, "SITE_TAGLINE") || "Courses to help you get the most out of the product.",
		emailVia,
		resendApiKey,
		emailFrom,
	};
}
