import { existsSync, statSync } from "node:fs";
import { resolve, normalize, join } from "node:path";
import { getEmbeddedAsset } from "../ui/embedded-assets.ts";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export class StaticAssetServer {
  private baseDir: string;
  private routePrefix: string;

  constructor(
    baseDir: string = join(process.cwd(), "assets"),
    routePrefix: string = "assets"
  ) {
    this.baseDir = resolve(baseDir);
    this.routePrefix = routePrefix.replace(/^\/+|\/+$/g, "");
    if (!existsSync(this.baseDir)) {
      try {
        mkdirSync(this.baseDir, { recursive: true });
      } catch {}
    }
  }

  private getContentType(filePath: string, defaultType: string | null): string {
    const extMatch = filePath.match(/\.[a-zA-Z0-9]+$/);
    const ext = extMatch ? extMatch[0].toLowerCase() : "";
    if (MIME_TYPES[ext]) {
      return MIME_TYPES[ext];
    }
    return defaultType || "application/octet-stream";
  }

  public async serve(req: Request, urlPath: string): Promise<Response> {
    // Strip leading /<routePrefix>/
    const prefixRegex = new RegExp(`^\\/?${this.routePrefix}\\/?`);
    const subpath = urlPath.replace(prefixRegex, "");
    const safePath = normalize(join(this.baseDir, subpath));

    // Path traversal check
    if (!safePath.startsWith(this.baseDir)) {
      return new Response("Forbidden: Invalid file path", { status: 403 });
    }

    if (!existsSync(safePath)) {
      const embedded = getEmbeddedAsset(subpath);
      if (embedded) {
        const bodyBytes =
          typeof embedded.content === "string"
            ? Buffer.byteLength(embedded.content, "utf-8")
            : embedded.content.byteLength;
        return new Response(embedded.content, {
          status: 200,
          headers: {
            "Content-Length": bodyBytes.toString(),
            "Content-Type": embedded.contentType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
      return new Response(`Asset not found: ${subpath}`, { status: 404 });
    }

    const stat = statSync(safePath);
    if (stat.isDirectory()) {
      return new Response("Directory listing is disabled", { status: 403 });
    }

    const file = Bun.file(safePath);
    const contentType = this.getContentType(safePath, file.type);
    const rangeHeader = req.headers.get("range");

    // Bun natively handles Range headers when passed directly to Response,
    // but handling explicitly ensures 206 Partial Content compliance for Subiquity ISO mounting
    if (rangeHeader && rangeHeader.startsWith("bytes=")) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

      if (start >= stat.size || end >= stat.size || start > end) {
        return new Response("Requested range not satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }

      const chunkLength = end - start + 1;
      const slicedFile = file.slice(start, end + 1);

      return new Response(slicedFile, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkLength.toString(),
          "Content-Type": contentType,
        },
      });
    }

    return new Response(file, {
      status: 200,
      headers: {
        "Content-Length": stat.size.toString(),
        "Accept-Ranges": "bytes",
        "Content-Type": contentType,
      },
    });
  }
}
