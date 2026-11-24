import {
	type AuthAdapter,
	type SignInForm,
	type SignInResult,
	normaliseEmail,
	normaliseName,
} from "./types";

/**
 * Demo sign-in: type a name and an email address and you are in. Nothing is
 * checked, so anyone can sign in as anyone. It exists so a first deploy works
 * without an email provider. Do not run a real academy on it.
 *
 * Demo identities are prefixed `demo:` so they can never be mistaken for a
 * verified address after you switch to magic links.
 */
export function createDemoAdapter(): AuthAdapter {
	return {
		mode: "demo",
		forProduction: false,
		async start(form: SignInForm): Promise<SignInResult> {
			const email = normaliseEmail(form.email);
			if (!email) return { kind: "invalid", message: "Enter a valid email address." };
			return {
				kind: "signed-in",
				identity: { id: `demo:${email}`, name: normaliseName(form.name, email), email },
			};
		},
		async finish() {
			return null;
		},
	};
}
