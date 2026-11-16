/**
 * The voice agent's health check (byggplan step 6.4, rule K10). The web app asks it before
 * every incoming call; when the process is down or does not answer within 1.5 s, the call goes
 * straight to the mechanic's mobile instead.
 */
import { createServer, type Server } from "node:http";

export function startHealthServer(input: {
  port: number;
  host?: string;
  /** Ready to take calls: false while starting or shutting down. */
  ready?: () => boolean;
}): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    const ok = input.ready?.() ?? true;
    response
      .writeHead(ok ? 200 : 503, { "content-type": "text/plain", "cache-control": "no-store" })
      .end(ok ? "ok" : "not ready");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host ?? "127.0.0.1", () => resolve(server));
  });
}
