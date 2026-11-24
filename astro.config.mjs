import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

// Every page is rendered on the server, on Cloudflare Workers. Nothing here
// ships JavaScript to the browser: forms post back to the page that drew them.
export default defineConfig({
	output: "server",
	// The academy serves no images of its own, so no image service is needed.
	adapter: cloudflare({ imageService: "passthrough" }),
	// The academy keeps its session in a signed cookie (src/lib/session.ts), so
	// Astro's own KV-backed sessions are switched off.
	session: false,
	devToolbar: { enabled: false },
});
