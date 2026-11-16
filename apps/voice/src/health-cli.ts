/**
 * The health check on its own, as the agent process runs it (`VOICE_HEALTH_PORT`, default
 * 8081). Prints the port once it listens, which the K10 test waits for.
 */
import type { AddressInfo } from "node:net";
import { startHealthServer } from "./health";

const server = await startHealthServer({ port: Number(process.env.VOICE_HEALTH_PORT ?? 8081) });
console.info(`[voice] health on ${String((server.address() as AddressInfo).port)}`);
