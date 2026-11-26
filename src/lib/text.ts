/**
 * Turns the text of a reading into HTML. It understands a small, safe subset
 * of Markdown: headings, paragraphs, bulleted and numbered lists, **bold**,
 * *italic*, `code`, [links](https://...), a callout (lines starting with
 * "> ") and a block of code between lines of three backticks. Everything else is shown as
 * written. All text is escaped, so content can never inject markup or script.
 *
 * Want full Markdown? Replace this function with a library of your choice.
 */

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function inline(value: string): string {
	return escapeHtml(value)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\*([^*]+)\*/g, "<em>$1</em>")
		.replace(
			/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
			'<a href="$2" rel="noopener noreferrer">$1</a>',
		);
}

export function renderText(source: string): string {
	// Blocks of code are lifted out first: blank lines inside one belong to it.
	const code: string[] = [];
	const text = source
		.replace(/\r\n?/g, "\n")
		.replace(/^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm, (_all, body: string) => {
			code.push(`<pre><code>${escapeHtml(body)}</code></pre>`);
			return `\n\n\uE000${code.length - 1}\uE000\n\n`;
		});
	const blocks = text.split(/\n{2,}/);
	const html: string[] = [];
	for (const block of blocks) {
		const lifted = /^\uE000(\d+)\uE000$/.exec(block.trim());
		if (lifted) {
			html.push(code[Number(lifted[1])] ?? "");
			continue;
		}
		const lines = block.split("\n").filter((line) => line.trim() !== "");
		if (lines.length === 0) continue;

		const heading = lines.length === 1 ? /^(#{1,3})\s+(.*)$/.exec(lines[0] ?? "") : null;
		if (heading) {
			// Readings sit under the page's h1 and the activity's h2.
			const level = Math.min((heading[1] ?? "#").length + 2, 5);
			html.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
			continue;
		}
		if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
			const items = lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
			html.push(`<ul>${items.join("")}</ul>`);
			continue;
		}
		if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
			const items = lines.map((line) => `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
			html.push(`<ol>${items.join("")}</ol>`);
			continue;
		}
		if (lines.every((line) => /^\s*>/.test(line))) {
			const said = lines.map((line) => inline(line.replace(/^\s*>\s?/, "")));
			html.push(`<blockquote><p>${said.join("<br>")}</p></blockquote>`);
			continue;
		}
		html.push(`<p>${lines.map(inline).join("<br>")}</p>`);
	}
	return html.join("\n");
}
