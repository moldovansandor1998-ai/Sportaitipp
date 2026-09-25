// Node 20 WebSocket-polyfill a supabase-js Realtime klienséhez (tesztkörnyezet).
import ws from "ws";

if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as Record<string, unknown>).WebSocket = ws as unknown;
}
