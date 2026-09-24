import { io, Socket } from "socket.io-client";
import { API_BASE } from "./api";

/**
 * chat-socket.ts — one shared Socket.io connection for both chat systems
 * (per-report threads via ReportChat, general support chat via SupportChat).
 * A single module-level singleton is used so navigating between pages (or
 * opening both a report thread and the support widget) doesn't open a new
 * TCP/WebSocket connection each time — matches how the backend's
 * ChatGateway expects one authenticated connection per browser tab, with
 * room joins/leaves happening on top of it (see backend/src/chat/chat.gateway.ts).
 */

let socket: Socket | null = null;

/** Derives the Socket.io server origin from API_BASE (which ends in "/api/v1"). */
function socketOrigin(): string {
  return API_BASE.replace(/\/api\/v1\/?$/, "");
}

/**
 * Returns the shared socket, connecting it lazily on first call. Returns
 * null during SSR (no window) or if there's no access token yet (logged
 * out) — callers should treat a null return as "real-time isn't available
 * right now", not as an error; the REST endpoints (listMessages/postMessage)
 * remain the source of truth regardless.
 */
export function getChatSocket(): Socket | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("ssc_access_token");
  if (!token) return null;

  if (socket && socket.connected) return socket;

  if (!socket) {
    socket = io(socketOrigin(), {
      path: "/api/v1/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  } else if (!socket.connected) {
    // Token may have been refreshed since the socket was created (see
    // lib/api.ts's tryRefresh) — re-set auth before reconnecting so a
    // stale/expired token doesn't get rejected by ChatGateway.handleConnection.
    socket.auth = { token };
    socket.connect();
  }
  return socket;
}

/** Call on logout so the next login gets a fresh, correctly-authed socket. */
export function disconnectChatSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
