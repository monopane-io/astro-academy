import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Every page is rendered on the server, on Cloudflare Workers. The browser
// gets one small script, Astro's client router (see src/layouts/Base.astro):
// it swaps pages in place, so following a link or sending a form never
// reloads the whole page. Without JavaScript the same links and forms work
// as ordinary page loads. Tailwind CSS runs at build time only.
export default defineConfig({
	output: "server",
	// The academy serves no images of its own, so no image service is needed.
	adapter: cloudflare({ imageService: "passthrough" }),
	// The academy keeps its session in a signed cookie (src/lib/session.ts), so
	// Astro's own KV-backed sessions are switched off.
	session: false,
	devToolbar: { enabled: false },
	vite: {
		plugins: [tailwindcss()],
	},
});
