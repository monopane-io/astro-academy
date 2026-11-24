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
