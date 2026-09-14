import { BaseOSProvider } from "../base.ts";
import type { BootContext, HostContext } from "../../types.ts";
import { renderUbuntuIpxe } from "./ipxe.ts";
import { renderUbuntuUserData, renderUbuntuMetaData } from "./autoinstall.ts";

export class UbuntuProvider extends BaseOSProvider {
  readonly id = "ubuntu";
  readonly name = "Ubuntu Server";

  renderIpxe(ctx: BootContext): string {
    return renderUbuntuIpxe(ctx);
  }

  handleConfig(subpath: string, _req: Request, ctx: HostContext): Response {
    const cleanSubpath = subpath.replace(/^\/+/, "");

    switch (cleanSubpath) {
      case "user-data":
        return this.yamlResponse(renderUbuntuUserData(ctx.hostConfig, ctx.baseUrl));

      case "meta-data":
        return this.yamlResponse(renderUbuntuMetaData(ctx.hostConfig));

      case "vendor-data":
        return this.yamlResponse("#cloud-config\n");

      default:
        return new Response(`Not Found: ${subpath}`, { status: 404 });
    }
  }
}
