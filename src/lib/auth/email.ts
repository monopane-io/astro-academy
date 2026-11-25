import type { EmailMessage, EmailSender } from "./types";

/**
 * Sends through Resend (https://resend.com). `from` must be an address on a
 * domain you have verified there, for example "Academy <academy@example.com>".
 * To use another provider, write another function that returns an EmailSender.
 */
export function resendSender(apiKey: string, from: string): EmailSender {
	return {
		async send(message: EmailMessage): Promise<void> {
			const response = await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					from,
					to: [message.to],
					subject: message.subject,
					text: message.text,
				}),
			});
			if (!response.ok) {
				throw new Error(`Resend answered ${response.status}: ${await response.text()}`);
			}
		},
	};
}

/**
 * Asks Monopane to send the sign-in email. For sites Monopane hosts, which
 * need no email account of their own. Monopane writes the email around the
 * link and sends it only when the link leads to one of your hosted sites, so
 * a site hosted elsewhere must use resendSender() instead.
 */
export function monopaneSender(options: {
	apiUrl: string;
	apiKey: string;
	projectId: string;
	environment: string;
}): EmailSender {
	return {
		async send(message: EmailMessage): Promise<void> {
			const response = await fetch(
				`${options.apiUrl}/projects/${encodeURIComponent(options.projectId)}/sign-in-emails`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${options.apiKey}`,
						"Content-Type": "application/json",
						"X-Environment": options.environment,
					},
					body: JSON.stringify({
						to: message.to,
						link: message.link,
						siteName: message.siteName,
					}),
				},
			);
			if (!response.ok) {
				throw new Error(`Monopane answered ${response.status}: ${await response.text()}`);
			}
		},
	};
}
