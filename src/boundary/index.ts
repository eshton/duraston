/** DUR-5 UI<->worker boundary — public surface. */
export type {
  ClientMessage,
  ServerEvent,
  ServerEventType,
  UnsequencedEvent,
} from "./protocol.js";
export { SessionGateway, type GatewayOptions } from "./gateway.js";
export { toSSE, parseSSE, resumeFrom } from "./sse.js";
