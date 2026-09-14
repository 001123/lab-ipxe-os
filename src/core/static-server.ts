import { existsSync, statSync } from "node:fs";
import { resolve, normalize, join } from "node:path";

export class StaticAssetServer {
  private baseDir: string;

  constructor(baseDir: string = join(process.cwd(), "assets")) {
    this.baseDir = resolve(baseDir);
  }

  public async serve(req: Request, urlPath: string): Promise<Response> {
    // Strip leading /assets/
    const subpath = urlPath.replace(/^\/?assets\/?/, "");
    const safePath = normalize(join(this.baseDir, subpath));

    // Path traversal check
    if (!safePath.startsWith(this.baseDir)) {
      return new Response("Forbidden: Invalid file path", { status: 403 });
    }

    if (!existsSync(safePath)) {
      return new Response(`Asset not found: ${subpath}`, { status: 404 });
    }

    const stat = statSync(safePath);
    if (stat.isDirectory()) {
      return new Response("Directory listing is disabled", { status: 403 });
    }

    const file = Bun.file(safePath);
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
          "Content-Type": file.type || "application/octet-stream",
        },
      });
    }

    return new Response(file, {
      status: 200,
      headers: {
        "Content-Length": stat.size.toString(),
        "Accept-Ranges": "bytes",
        "Content-Type": file.type || "application/octet-stream",
      },
    });
  }
}
