import dashboardCss from "../../public/css/dashboard.css" with { type: "text" };
import dashboardJs from "../../public/js/dashboard.js" with { type: "text" };

export interface EmbeddedAsset {
  content: string;
  contentType: string;
}

export const EMBEDDED_PUBLIC_ASSETS: Record<string, EmbeddedAsset> = {
  "css/dashboard.css": {
    content: dashboardCss,
    contentType: "text/css; charset=utf-8",
  },
  "js/dashboard.js": {
    content: dashboardJs,
    contentType: "text/javascript; charset=utf-8",
  },
};

/**
 * Retrieve embedded asset by relative subpath (e.g. "css/dashboard.css" or "js/dashboard.js")
 */
export function getEmbeddedAsset(subpath: string): EmbeddedAsset | null {
  const clean = subpath.replace(/^\/+|\/+$/g, "");
  return EMBEDDED_PUBLIC_ASSETS[clean] || null;
}
