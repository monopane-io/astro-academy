import type { Config } from "../config";
import { createDemoAdapter } from "./demo";
import { resendSender } from "./email";
import { createMagicLinkAdapter } from "./magic-link";
import type { AuthAdapter, TokenStore } from "./types";

/**
 * The sign-in adapter for this deployment, chosen by AUTH_MODE. This is the
 * one place to change if you bring your own sign-in.
 */
export function getAuthAdapter(config: Config, store: TokenStore | undefined): AuthAdapter {
	if (config.authMode === "magic-link" && store && config.resendApiKey && config.emailFrom) {
		return createMagicLinkAdapter({
			store,
			sender: resendSender(config.resendApiKey, config.emailFrom),
			siteName: config.siteName,
		});
	}
	return createDemoAdapter();
}
