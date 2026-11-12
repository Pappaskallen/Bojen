import { createServer, type Server } from "node:http";

/**
 * A stand-in for the 46elks API in the end-to-end tests (byggplan step 3.1). The web app
 * uses its real 46elks adapter against this server, so the test also covers the request
 * the adapter makes. `GET /sent` lists what was "sent"; nothing leaves the machine.
 */
export const FAKE_ELKS_PORT = 3199;
export const FAKE_ELKS_URL = `http://127.0.0.1:${String(FAKE_ELKS_PORT)}`;
export const FAKE_ELKS_USER = "e2e-user";
export const FAKE_ELKS_PASSWORD = "e2e-password";

export interface FakeElksSms {
  id: string;
  from: string;
  to: string;
  message: string;
}

export function startFakeElks(): Promise<Server> {
  const sent: FakeElksSms[] = [];
  const expected = `Basic ${Buffer.from(`${FAKE_ELKS_USER}:${FAKE_ELKS_PASSWORD}`).toString("base64")}`;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url === "/sent") {
        response.end(JSON.stringify(sent));
        return;
      }
      if (request.method !== "POST" || request.url !== "/a1/sms") {
        response.statusCode = 404;
        response.end("{}");
        return;
      }
      if (request.headers.authorization !== expected) {
        response.statusCode = 401;
        response.end("{}");
        return;
      }
      const form = new URLSearchParams(body);
      const sms = {
        id: `s${String(sent.length + 1)}`,
        from: form.get("from") ?? "",
        to: form.get("to") ?? "",
        message: form.get("message") ?? "",
      };
      sent.push(sms);
      response.end(JSON.stringify({ ...sms, status: "created", direction: "outgoing" }));
    });
  });
  return new Promise((resolve) =>
    server.listen(FAKE_ELKS_PORT, "127.0.0.1", () => resolve(server)),
  );
}
