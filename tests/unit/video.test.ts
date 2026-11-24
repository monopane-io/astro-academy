import { describe, expect, it } from "vitest";
import { formatMinutes, formatSeconds } from "../../src/lib/format";
import { videoPlayer } from "../../src/lib/video";

describe("videoPlayer", () => {
	it("embeds YouTube in its no-cookie player, whatever shape the address has", () => {
		const expected = {
			kind: "embed",
			src: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
			host: "YouTube",
		};
		for (const address of [
			"https://www.youtube.com/watch?v=aqz-KE-bpKQ",
			"https://youtube.com/watch?v=aqz-KE-bpKQ&t=30s",
			"https://youtu.be/aqz-KE-bpKQ",
			"https://www.youtube.com/embed/aqz-KE-bpKQ",
			"https://www.youtube.com/shorts/aqz-KE-bpKQ",
		]) {
			expect(videoPlayer(address), address).toEqual(expected);
		}
	});

	it("embeds Vimeo, Loom and Wistia", () => {
		expect(videoPlayer("https://vimeo.com/123456789")).toEqual({
			kind: "embed",
			src: "https://player.vimeo.com/video/123456789?dnt=1",
			host: "Vimeo",
		});
		expect(videoPlayer("https://www.loom.com/share/abc123DEF")).toMatchObject({
			src: "https://www.loom.com/embed/abc123DEF",
		});
		expect(videoPlayer("https://acme.wistia.com/medias/x1y2z3")).toMatchObject({
			src: "https://fast.wistia.net/embed/iframe/x1y2z3",
		});
	});

	it("plays a direct file in the browser", () => {
		expect(videoPlayer("https://cdn.example.com/clips/tour.mp4?sig=1")).toEqual({
			kind: "file",
			src: "https://cdn.example.com/clips/tour.mp4?sig=1",
		});
	});

	it("falls back to a link for a host it does not know", () => {
		expect(videoPlayer("https://videos.example.com/watch/42")).toEqual({
			kind: "link",
			href: "https://videos.example.com/watch/42",
		});
	});

	it("shows nothing for an address that is not https, and never builds an embed from odd input", () => {
		expect(videoPlayer("http://cdn.example.com/a.mp4")).toBeNull();
		expect(videoPlayer("javascript:alert(1)")).toBeNull();
		expect(videoPlayer("not a url")).toBeNull();
		// An ID with markup in it is not an ID: it becomes a plain link, not an embed.
		expect(videoPlayer('https://www.youtube.com/watch?v="><script>')?.kind).toBe("link");
		expect(videoPlayer("https://vimeo.com/channels/staffpicks")?.kind).toBe("link");
	});
});

describe("durations", () => {
	it("are written the way a person says them", () => {
		expect(formatMinutes(45)).toBe("45 min");
		expect(formatMinutes(60)).toBe("1 h");
		expect(formatMinutes(90)).toBe("1 h 30 min");
		expect(formatSeconds(372)).toBe("7 min");
		expect(formatSeconds(20)).toBe("1 min");
	});
});
