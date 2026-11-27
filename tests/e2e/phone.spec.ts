import { type Page, expect, test } from "@playwright/test";

/**
 * Navigation in a narrow window, for a user and for an admin: one menu
 * button that slides a drawer in over a dimmed page, with the pages at the
 * top and the account at the bottom. It opens and closes without any script.
 */

const EMAIL = process.env.MONOPANE_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.MONOPANE_ADMIN_PASSWORD ?? "";

test.use({ viewport: { width: 390, height: 780 } });

const drawer = (page: Page) => page.locator("[data-drawer]:popover-open");
const openMenu = async (page: Page) => {
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(drawer(page)).toBeVisible();
};

async function signIn(page: Page, name: string) {
	await page.goto("/sign-in");
	await page.getByLabel("Your name").fill(name);
	await page.getByLabel("Email address").fill(`phone-${Date.now()}@example.com`);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/\/$/);
}

test("a user's header on a phone is one menu button and a drawer", async ({ page }) => {
	await signIn(page, "Mary Jackson");

	// One button in the bar; no second menu, and nothing wider than the window.
	const bar = page.getByRole("banner");
	await expect(bar.getByRole("button")).toHaveCount(1);
	await expect(page.getByLabel(/^Account: /)).toBeHidden();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		),
	).toBe(0);

	// The drawer: pages at the top, each once; the account at the bottom.
	await openMenu(page);
	// (The foot of the page lists the pages too; that is not a menu.)
	await expect(bar.getByRole("link", { name: "My learning" })).toHaveCount(1);
	await expect(drawer(page).getByRole("link", { name: "Courses" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(drawer(page).locator("[data-account-card]")).toContainText("Mary Jackson");
	await expect(drawer(page).getByRole("button", { name: "Sign out" })).toBeVisible();
	// It covers the page: the panel sits over a dimmed layer that fills the window.
	const size = await drawer(page).boundingBox();
	expect(size?.width).toBe(390);

	// Escape closes it, and so does a press beside the panel.
	await page.keyboard.press("Escape");
	await expect(drawer(page)).toBeHidden();
	await openMenu(page);
	await page.mouse.click(370, 400);
	await expect(drawer(page)).toBeHidden();

	// Going somewhere closes it: the next page arrives with the drawer shut.
	await openMenu(page);
	await drawer(page).getByRole("link", { name: "My learning" }).click();
	await expect(page).toHaveURL("/my-learning");
	await expect(drawer(page)).toBeHidden();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("My learning");

	// Signing out is in the drawer.
	await openMenu(page);
	await drawer(page).getByRole("button", { name: "Sign out" }).click();
	await expect(page).toHaveURL(/\/signed-out$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are signed out");
	await openMenu(page);
	await expect(drawer(page).getByRole("link", { name: "Sign in" })).toBeVisible();
	await expect(bar.getByRole("link", { name: "My learning" })).toHaveCount(0);
});

test("the drawer opens and closes with JavaScript off, and holds nothing", async ({ browser }) => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 780 },
		javaScriptEnabled: false,
		// The test runner cannot wait for the slide to finish without script
		// in the page, so the page is asked for no motion.
		reducedMotion: "reduce",
	});
	const page = await context.newPage();
	await page.goto("/");
	await openMenu(page);
	await expect(drawer(page).getByRole("link", { name: "Courses" })).toBeVisible();
	// The keyboard can leave it and it can be shut, with no script to help.
	await page.keyboard.press("Escape");
	await expect(drawer(page)).toBeHidden();
	await openMenu(page);
	await drawer(page).getByRole("button", { name: "Close" }).click();
	await expect(drawer(page)).toBeHidden();
	// A link in it is an ordinary link.
	await openMenu(page);
	await drawer(page).getByRole("link", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/\/sign-in$/);
	await context.close();
});

test("an admin's navigation on a phone is the same drawer", async ({ page }) => {
	test.skip(!EMAIL || !PASSWORD, "MONOPANE_ADMIN_EMAIL and MONOPANE_ADMIN_PASSWORD are not set");
	await page.goto("/admin");
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.getByRole("button", { name: "Allow" }).click();
	await expect(page).toHaveURL(/\/admin$/);

	// The column is gone; a bar with one button stands in for it.
	await expect(page.locator("aside[data-admin-bar]")).toBeHidden();
	await expect(page.locator("div[data-admin-bar]").getByRole("button")).toHaveCount(1);

	await openMenu(page);
	await expect(drawer(page).getByRole("link", { name: "Overview" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	// Who is signed in, and the way out, are in it.
	await expect(drawer(page).locator("[data-admin-account]")).toContainText(EMAIL);
	await expect(drawer(page).locator("[data-admin-time-left]")).toContainText("more minutes");
	await expect(drawer(page).getByRole("button", { name: "Leave admin" })).toBeVisible();

	// Going to another part closes it.
	await drawer(page).getByRole("link", { name: "Users" }).click();
	await expect(page).toHaveURL(/\/admin\/users$/);
	await expect(drawer(page)).toBeHidden();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");

	await openMenu(page);
	await page.keyboard.press("Escape");
	await expect(drawer(page)).toBeHidden();
	await openMenu(page);
	await drawer(page).getByRole("button", { name: "Leave admin" }).click();
	await expect(page).toHaveURL(/\/$/);

	// After leaving, the next sign-in asks for the password again, even though
	// Monopane still remembers this browser.
	await page.goto("/admin");
	await expect(page.getByLabel("Password")).toBeVisible();
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.getByRole("button", { name: "Allow" }).click();
	await expect(page).toHaveURL(/\/admin$/);
});
