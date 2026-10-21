// Cloudflare's TCP socket API (only what smtp.ts uses). An ambient module
// declaration, so this file must not import or export anything itself.
declare module "cloudflare:sockets" {
  interface Socket {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
    startTls(): Socket;
    close(): Promise<void>;
  }
  export function connect(
    address: { hostname: string; port: number },
    options?: { secureTransport?: "off" | "on" | "starttls"; allowHalfOpen?: boolean },
  ): Socket;
}
