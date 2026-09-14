import type { BootContext, HostContext, OSProvider } from "../types.ts";

export type { OSProvider };

export abstract class BaseOSProvider implements OSProvider {
  abstract readonly id: string;
  abstract readonly name: string;

  abstract renderIpxe(ctx: BootContext): string;

  abstract handleConfig(
    subpath: string,
    req: Request,
    ctx: HostContext
  ): Promise<Response> | Response;

  protected textResponse(content: string, contentType: string = "text/plain; charset=utf-8"): Response {
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": contentType,
      },
    });
  }

  protected yamlResponse(content: string): Response {
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
      },
    });
  }
}
