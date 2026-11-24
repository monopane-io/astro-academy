import { describe, expect, it } from "vitest";
import { createDemoAdapter } from "../../src/lib/auth/demo";
import { MAGIC_LINK_TTL, createMagicLinkAdapter } from "../../src/lib/auth/magic-link";
import type { EmailMessage, EmailSender, TokenStore } from "../../src/lib/auth/types";

/** An in-memory stand-in for the KV namespace. */
function memoryStore() {
	const items = new Map<string, { value: string; ttl?: number }>();
	const store: TokenStore = {
		async get(key) {
			return items.get(key)?.value ?? null;
		},
		async put(key, value, options) {
			items.set(key, { value, ttl: options?.expirationTtl });
		},
		async delete(key) {
			items.delete(key);
		},
	};
	return { store, items };
}

/** A sender that sends nothing and remembers what it was asked to send. */
function fakeSender(fail = false) {
	const sent: EmailMessage[] = [];
	const sender: EmailSender = {
		async send(message) {
			if (fail) throw new Error("provider is down");
			sent.push(message);
		},
	};
	return { sender, sent };
}

function setup(options: { failSend?: boolean } = {}) {
	const { store, items } = memoryStore();
	const { sender, sent } = fakeSender(options.failSend);
	let time = Date.UTC(2026, 0, 1, 12, 0, 0);
	const adapter = createMagicLinkAdapter({
		store,
		sender,
		siteName: "Acme Academy",
		now: () => time,
	});
	return {
		adapter,
		items,
		sent,
		advance(seconds: number) {
			time += seconds * 1000;
		},
		tokenFrom(message: EmailMessage | undefined): string {
			return /token=([0-9a-f]{64})/.exec(message?.text ?? "")?.[1] ?? "";
		},
	};
}

const form = {
	name: "Ada Lovelace",
	email: "Ada@Example.com",
	origin: "https://academy.example",
	next: "/courses/intro",
};

describe("demo sign-in", () => {
	const adapter = createDemoAdapter();

	it("signs in anyone with a name and an email, and says it is not for production", async () => {
		expect(adapter.forProduction).toBe(false);
		expect(await adapter.start(form)).toEqual({
			kind: "signed-in",
			identity: { id: "demo:ada@example.com", name: "Ada Lovelace", email: "ada@example.com" },
		});
	});

	it("asks again for a bad email address", async () => {
		expect(await adapter.start({ ...form, email: "not-an-email" })).toEqual({
			kind: "invalid",
			message: "Enter a valid email address.",
		});
	});

	it("has no links to finish", async () => {
		expect(await adapter.finish("a".repeat(64))).toBeNull();
	});
});

describe("magic-link sign-in", () => {
	it("emails a link and signs in the address it was sent to", async () => {
		const t = setup();
		expect(t.adapter.forProduction).toBe(true);
		expect(await t.adapter.start(form)).toEqual({ kind: "link-sent" });

		expect(t.sent).toHaveLength(1);
		expect(t.sent[0]?.to).toBe("ada@example.com");
		expect(t.sent[0]?.subject).toBe("Sign in to Acme Academy");
		expect(t.sent[0]?.text).toContain("https://academy.example/auth/verify?token=");

		expect(await t.adapter.finish(t.tokenFrom(t.sent[0]))).toEqual({
			identity: { id: "email:ada@example.com", name: "Ada Lovelace", email: "ada@example.com" },
			next: "/courses/intro",
		});
	});

	it("works once", async () => {
		const t = setup();
		await t.adapter.start(form);
		const token = t.tokenFrom(t.sent[0]);
		expect(await t.adapter.finish(token)).not.toBeNull();
		expect(await t.adapter.finish(token)).toBeNull();
		expect(t.items.size).toBe(0);
	});

	it("expires after 15 minutes", async () => {
		const t = setup();
		await t.adapter.start(form);
		expect(MAGIC_LINK_TTL).toBe(900);
		expect([...t.items.values()][0]?.ttl).toBe(900);

		t.advance(14 * 60 + 59);
		const early = setup();
		await early.adapter.start(form);
		early.advance(14 * 60 + 59);
		expect(await early.adapter.finish(early.tokenFrom(early.sent[0]))).not.toBeNull();

		t.advance(2);
		// Even if the store has not dropped the token yet, it is refused, and spent.
		expect(await t.adapter.finish(t.tokenFrom(t.sent[0]))).toBeNull();
		expect(t.items.size).toBe(0);
	});

	it("signs in only the address the link went to", async () => {
		const t = setup();
		await t.adapter.start(form);
		await t.adapter.start({ ...form, email: "grace@example.com", name: "Grace" });
		const [first, second] = t.sent;
		expect((await t.adapter.finish(t.tokenFrom(second)))?.identity.email).toBe("grace@example.com");
		expect((await t.adapter.finish(t.tokenFrom(first)))?.identity.email).toBe("ada@example.com");
	});

	it("refuses tokens it did not issue", async () => {
		const t = setup();
		await t.adapter.start(form);
		for (const token of ["", "nonsense", "f".repeat(64), `${t.tokenFrom(t.sent[0])}0`]) {
			expect(await t.adapter.finish(token)).toBeNull();
		}
		// The real link still works afterwards.
		expect(await t.adapter.finish(t.tokenFrom(t.sent[0]))).not.toBeNull();
	});

	it("stores a hash, not the token", async () => {
		const t = setup();
		await t.adapter.start(form);
		const token = t.tokenFrom(t.sent[0]);
		for (const [key, item] of t.items) {
			expect(key).not.toContain(token);
			expect(item.value).not.toContain(token);
		}
	});

	it("answers the same whether or not the email could be sent", async () => {
		const working = setup();
		const broken = setup({ failSend: true });
		expect(await broken.adapter.start(form)).toEqual(await working.adapter.start(form));
	});

	it("does not carry an off-site return address", async () => {
		const t = setup();
		await t.adapter.start({ ...form, next: "https://evil.example/" });
		expect((await t.adapter.finish(t.tokenFrom(t.sent[0])))?.next).toBe("/");
	});

	it("asks again for a bad email address, and sends nothing", async () => {
		const t = setup();
		expect((await t.adapter.start({ ...form, email: "nope" })).kind).toBe("invalid");
		expect(t.sent).toHaveLength(0);
		expect(t.items.size).toBe(0);
	});
});
