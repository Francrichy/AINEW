// Mlimani Sound Library now uses curated, deployment-bundled assets only.
// No Cloudflare R2 or other paid object storage is required.
export function registerStudioLibraryRoutes() {
  // The public catalogue is served directly from /sounds/library.json.
  // Customer uploads are intentionally not stored on Render's ephemeral filesystem.
}
