import { BaseOSProvider } from "../base.ts";
import type { BootContext, HostContext } from "../../types.ts";
import { renderTalosIpxe } from "./ipxe.ts";
import { renderTalosMachineConfig } from "./config.ts";

export class TalosProvider extends BaseOSProvider {
  readonly id = "talos";
  readonly name = "Talos Linux";

  renderIpxe(ctx: BootContext): string {
    return renderTalosIpxe(ctx);
  }

  handleConfig(subpath: string, _req: Request, ctx: HostContext): Response {
    const cleanSubpath = subpath.replace(/^\/+/, "");

    if (
      cleanSubpath === "config.yaml" ||
      cleanSubpath === "controlplane.yaml" ||
      cleanSubpath === "worker.yaml"
    ) {
      return this.yamlResponse(renderTalosMachineConfig(ctx.hostConfig));
    }

    return new Response(`Not Found: ${subpath}`, { status: 404 });
  }
}
