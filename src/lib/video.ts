/**
 * How to show a video activity. Monopane stores only the video's address; this
 * works out, from the address alone, whether it can be played on the page.
 *
 *   - a page on a known host (YouTube, Vimeo, Loom, Wistia) becomes that
 *     host's embedded player
 *   - a direct video file is played by the browser
 *   - anything else is shown as a link
 *
 * To support another host, add a case that returns its embed address.
 */

export type VideoPlayer =
	| { kind: "embed"; src: string; host: string }
	| { kind: "file"; src: string }
	| { kind: "link"; href: string };

const FILE = /\.(mp4|webm|ogv|ogg|mov|m4v)$/i;
const ID = /^[A-Za-z0-9_-]{3,64}$/;

export function videoPlayer(address: string): VideoPlayer | null {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return null;
	}
	if (url.protocol !== "https:") return null;

	const host = url.hostname.replace(/^www\./, "").toLowerCase();
	const parts = url.pathname.split("/").filter(Boolean);
	const embed = (src: string, name: string): VideoPlayer => ({ kind: "embed", src, host: name });

	if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
		const id =
			parts[0] === "watch"
				? url.searchParams.get("v")
				: parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live"
					? parts[1]
					: null;
		// The no-cookie player does not track the user until they press play.
		if (id && ID.test(id)) return embed(`https://www.youtube-nocookie.com/embed/${id}`, "YouTube");
	}
	if (host === "youtu.be" && parts[0] && ID.test(parts[0])) {
		return embed(`https://www.youtube-nocookie.com/embed/${parts[0]}`, "YouTube");
	}
	if (host === "vimeo.com" || host === "player.vimeo.com") {
		const id = parts[0] === "video" ? parts[1] : parts[0];
		if (id && /^\d+$/.test(id)) return embed(`https://player.vimeo.com/video/${id}?dnt=1`, "Vimeo");
	}
	if (host === "loom.com" && (parts[0] === "share" || parts[0] === "embed")) {
		if (parts[1] && ID.test(parts[1]))
			return embed(`https://www.loom.com/embed/${parts[1]}`, "Loom");
	}
	if (host.endsWith(".wistia.com") || host === "wistia.com") {
		const at = parts.indexOf("medias");
		const id = at >= 0 ? parts[at + 1] : undefined;
		if (id && ID.test(id)) return embed(`https://fast.wistia.net/embed/iframe/${id}`, "Wistia");
	}

	if (FILE.test(url.pathname)) return { kind: "file", src: url.href };
	return { kind: "link", href: url.href };
}
