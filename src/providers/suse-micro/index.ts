import { BaseOSProvider } from "../base.ts";
import type { BootContext, HostContext } from "../../types.ts";
import { renderSuseMicroIpxe } from "./ipxe.ts";
import { renderSuseCombustionScript } from "./combustion.ts";

export class SuseMicroProvider extends BaseOSProvider {
  readonly id = "suse-micro";
  readonly name = "openSUSE Leap Micro";

  renderIpxe(ctx: BootContext): string {
    return renderSuseMicroIpxe(ctx);
  }

  handleConfig(subpath: string, _req: Request, ctx: HostContext): Response {
    const cleanSubpath = subpath.replace(/^\/+/, "");

    if (cleanSubpath === "combustion/script" || cleanSubpath === "script") {
      return this.textResponse(
        renderSuseCombustionScript(ctx.hostConfig, ctx.baseUrl),
        "text/x-shellscript; charset=utf-8"
      );
    }

    return new Response(`Not Found: ${subpath}`, { status: 404 });
  }
}
