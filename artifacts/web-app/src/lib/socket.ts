// Singleton Socket.io client — one connection shared across the whole app.
// Call getAppSocket(token) to get (or lazily create) the shared socket.
// Call disconnectAppSocket() on logout.
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
let activeToken: string | null = null;

/**
 * Return the shared socket, creating it if necessary.
 * If the token has changed (e.g. re-login), the old socket is disconnected
 * and a fresh one is created transparently.
 */
export function getAppSocket(token: string | null): Socket | null {
  if (!token) {
    disconnectAppSocket();
    return null;
  }

  // Token rotated — reconnect so the server sees the new identity.
  if (socket && activeToken !== token) {
    socket.disconnect();
    socket = null;
    activeToken = null;
  }

  if (!socket) {
    socket = io({ path: "/api/socket.io", auth: { token }, transports: ["websocket"] });
    activeToken = token;
  }

  return socket;
}

export function disconnectAppSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    activeToken = null;
  }
}
