import { BaseOSProvider } from "../base.ts";
import type { BootContext, HostContext } from "../../types.ts";
import { renderProxmoxIpxe } from "./ipxe.ts";
import { renderProxmoxAnswer, renderProxmoxFirstBootScript } from "./answer.ts";

export * from "./answer.ts";
export * from "./profiles/index.ts";

export class ProxmoxProvider extends BaseOSProvider {
  readonly id = "proxmox";
  readonly name = "Proxmox VE";

  renderIpxe(ctx: BootContext): string {
    return renderProxmoxIpxe(ctx);
  }

  handleConfig(subpath: string, _req: Request, ctx: HostContext): Response {
    const cleanSubpath = subpath.replace(/^\/+/, "");

    if (cleanSubpath === "answer.toml" || cleanSubpath === "answer") {
      return this.textResponse(renderProxmoxAnswer(ctx.hostConfig, ctx.baseUrl));
    }

    if (cleanSubpath === "first-boot.sh" || cleanSubpath === "first-boot") {
      return this.textResponse(
        renderProxmoxFirstBootScript(ctx.hostConfig, ctx.baseUrl),
        "text/x-shellscript; charset=utf-8"
      );
    }

    return new Response(`Not Found: ${subpath}`, { status: 404 });
  }
}
