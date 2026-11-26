import { describe, expect, it } from "vitest";
import { renderText } from "../../src/lib/text";

describe("renderText", () => {
	it("turns blank-line-separated text into paragraphs", () => {
		expect(renderText("One.\n\nTwo\nlines.")).toBe("<p>One.</p>\n<p>Two<br>lines.</p>");
	});

	it("understands headings, lists and inline marks", () => {
		expect(renderText("## Title")).toBe("<h4>Title</h4>");
		expect(renderText("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
		expect(renderText("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
		expect(renderText("**bold** *soft* `code`")).toBe(
			"<p><strong>bold</strong> <em>soft</em> <code>code</code></p>",
		);
		expect(renderText("[Monopane](https://monopane.io)")).toBe(
			'<p><a href="https://monopane.io" rel="noopener noreferrer">Monopane</a></p>',
		);
	});

	it("never lets content inject markup", () => {
		const html = renderText('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;script&gt;");
	});

	it("only links to http and https", () => {
		expect(renderText("[x](javascript:alert(1))")).not.toContain("<a ");
		expect(renderText('[x](https://a.example/"onmouseover="alert(1))')).not.toContain(
			'"onmouseover',
		);
	});

	it("draws lines starting with > as a callout", () => {
		expect(renderText("> Mind **this**.\n> And this.")).toBe(
			"<blockquote><p>Mind <strong>this</strong>.<br>And this.</p></blockquote>",
		);
	});

	it("keeps a block of code as written, blank lines and markup included", () => {
		expect(renderText("Before\n\n```js\nconst a = 1;\n\n<b>*x*</b>\n```\n\nAfter")).toBe(
			"<p>Before</p>\n<pre><code>const a = 1;\n\n&lt;b&gt;*x*&lt;/b&gt;</code></pre>\n<p>After</p>",
		);
	});
});
