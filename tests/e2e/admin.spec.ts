import { expect, test } from "@playwright/test";

/**
 * The admin area, against a real Monopane API: someone who runs the project
 * signs in with their Monopane account and sees every course, drafts
 * included. Along the way: the token that lets them never reaches the
 * browser, a form sent from elsewhere is refused, and a visitor who is not
 * signed in sees nothing an admin does.
 *
 * It needs a person to sign in as: MONOPANE_ADMIN_EMAIL and
 * MONOPANE_ADMIN_PASSWORD, someone with access to the project, and the site's
 * address added to the project's sign-in addresses. Without them the test is
 * skipped; everything else still runs.
 */

const EMAIL = process.env.MONOPANE_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.MONOPANE_ADMIN_PASSWORD ?? "";
const API_URL = process.env.MONOPANE_API_URL ?? "https://api.monopane.io";
const DRAFT = "/courses/unpublished-course";

test.describe.configure({ mode: "serial" });

test("nobody reaches the admin area without signing in", async ({ page, request }) => {
	const response = await request.get("/admin", { maxRedirects: 0 });
	expect(response.status()).toBe(302);
	expect(response.headers().location).toBe("/admin/sign-in?next=%2Fadmin");
	expect(response.headers()["cache-control"]).toBe("private, no-store");
	expect(response.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");

	// Signing in is started at Monopane, with PKCE and a state, and this site's own callback.
	const start = await request.get("/admin/sign-in", { maxRedirects: 0 });
	const authorize = new URL(start.headers().location ?? "");
	expect(authorize.origin).toBe(new URL(API_URL).origin);
	expect(authorize.pathname).toBe("/oauth/authorize");
	expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
	expect(authorize.searchParams.get("state")).toBeTruthy();
	expect(authorize.searchParams.get("redirect_uri")).toMatch(/\/admin\/callback$/);

	// A reply nobody asked for signs nobody in.
	await page.goto("/admin/callback?code=made-up&state=made-up");
	await expect(page.locator("[data-admin-sign-in-failed=expired]")).toBeVisible();
	await page.goto("/admin");
	await expect(page).not.toHaveURL(/\/admin$/);

	// A form sent from another site is refused before anything else happens.
	const forged = await request.post("/admin/sign-out", {
		headers: { Origin: "https://evil.example" },
		maxRedirects: 0,
	});
	expect(forged.status()).toBe(403);
});

test("an admin signs in with Monopane and sees every course, drafts included", async ({
	page,
	context,
	browser,
}) => {
	test.skip(!EMAIL || !PASSWORD, "MONOPANE_ADMIN_EMAIL and MONOPANE_ADMIN_PASSWORD are not set");

	const sitePages: string[] = [];
	page.on("response", async (response) => {
		if (new URL(response.url()).origin !== new URL(page.url() || "http://x").origin) return;
		if (!(response.headers()["content-type"] ?? "").includes("text/html")) return;
		const html = await response.text().catch(() => null);
		if (html) sitePages.push(html);
	});

	// --- Sign in at Monopane --------------------------------------------------
	await page.goto("/admin");
	await expect(page).toHaveURL(new RegExp(`^${API_URL.replace(/[.]/g, "\\.")}/oauth/authorize`));
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	// Monopane says which project and which site, and what the site may do.
	const site = new URL(process.env.SITE_URL ?? "http://127.0.0.1:4321").origin;
	await expect(page.getByText(site)).toBeVisible();
	await expect(page.getByText(/see users and their progress/)).toBeVisible();
	await page.getByRole("button", { name: "Allow" }).click();

	// --- The admin area -------------------------------------------------------
	await expect(page).toHaveURL(/\/admin$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Courses");
	await expect(page.locator("[data-admin-summary]")).toHaveText("1 published, 1 in draft.");
	const published = page.locator("[data-admin-course=academy-tour]");
	await expect(published.locator("[data-state]")).toHaveText("Published");
	await expect(published.getByRole("link", { name: "View" })).toHaveAttribute(
		"href",
		"/courses/academy-tour",
	);
	const draft = page.locator("[data-admin-course=unpublished-course]");
	await expect(draft.locator("[data-state]")).toHaveText("Draft");
	await expect(draft.getByRole("link", { name: "View" })).toHaveCount(0);
	await expect(page.locator("[data-admin-time-left]")).toContainText("more minutes");

	// --- What the browser holds -----------------------------------------------
	const cookies = await context.cookies();
	const admin = cookies.find((cookie) => /(^|-)admin$/.test(cookie.name));
	expect(admin, "the admin cookie").toBeTruthy();
	expect(admin?.httpOnly).toBe(true);
	expect(admin?.sameSite).toBe("Lax");
	expect(admin?.domain.startsWith(".")).toBe(false);
	// The token is in no cookie as it stands, in no page, and not in the address bar.
	for (const cookie of cookies) expect(cookie.value, cookie.name).not.toMatch(/mpa_/);
	expect(cookies.some((cookie) => cookie.name.includes("admin_start"))).toBe(false);
	await page.reload();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Courses");
	expect(sitePages.length).toBeGreaterThan(0);
	for (const html of sitePages) {
		expect(html).not.toMatch(/mpa_[0-9a-f]{8}/);
		expect(html).not.toMatch(/mpk_(live|test)_/);
	}
	expect(await page.evaluate(() => document.cookie)).not.toContain("admin");

	// --- An admin's view does not leak to anyone else ---------------------------
	// The admin has now read the draft through Monopane. A visitor still cannot.
	const stranger = await browser.newContext();
	const visitor = await stranger.newPage();
	expect((await visitor.goto(DRAFT))?.status()).toBe(404);
	await visitor.goto("/");
	await expect(visitor.getByText("Unpublished")).toHaveCount(0);
	expect((await stranger.request.get("/admin", { maxRedirects: 0 })).status()).toBe(302);
	await stranger.close();
	// Being an admin is not being a learner: the learner pages still ask for sign-in.
	await page.goto("/my-learning");
	await expect(page).toHaveURL(/\/sign-in\?next=/);

	// --- Leave ----------------------------------------------------------------
	await page.goto("/admin");
	const token = admin?.value ?? "";
	await page.getByRole("button", { name: "Leave admin" }).click();
	await expect(page).toHaveURL(/\/$/);
	expect((await context.cookies()).some((cookie) => /(^|-)admin$/.test(cookie.name))).toBe(false);
	// The old cookie is worth nothing now: the token behind it was ended at Monopane.
	const replay = await browser.newContext();
	await replay.addCookies([
		{ name: admin?.name ?? "admin", value: token, url: site, httpOnly: true, sameSite: "Lax" },
	]);
	const replayed = await replay.newPage();
	await replayed.goto("/admin");
	await expect(replayed).not.toHaveURL(/\/admin$/);
	await replay.close();
});
