/// <reference types="astro/client" />

interface Env {
	MONOPANE_API_KEY?: string;
	MONOPANE_PROJECT_ID?: string;
	/** The older name of MONOPANE_PROJECT_ID. */
	MONOPANE_TENANT_ID?: string;
	SESSION_SECRET?: string;
	MONOPANE_ENVIRONMENT?: string;
	MONOPANE_API_URL?: string;
	AUTH_MODE?: string;
	SITE_NAME?: string;
	SITE_TAGLINE?: string;
	RESEND_API_KEY?: string;
	EMAIL_FROM?: string;
	MAGIC_LINKS?: import("./lib/auth/types").TokenStore;
}

declare module "cloudflare:workers" {
	export const env: Env;
}

declare namespace App {
	interface Locals {
		/** The signed-in person, or null. Set by src/middleware.ts. */
		user: import("./lib/auth/types").User | null;
		/** The signed-in admin's session, or null. Set by src/middleware.ts. */
		admin: import("./lib/admin/session").AdminSession | null;
		config: import("./lib/config").Config;
	}
}
