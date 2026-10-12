import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

type Address = { address: string; family: number };
type Reply = { status: number; headers: Headers; body: Buffer };
export type SafeFetchErrorCode =
  | "non_https"
  | "unsafe_destination"
  | "redirects_disallowed"
  | "too_many_redirects"
  | "invalid_redirect"
  | "too_large"
  | "timeout"
  | "fetch_failed";
export class SafeFetchError extends Error {
  constructor(public readonly code: SafeFetchErrorCode) {
    super(code);
  }
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");

function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}

/** Network-only seam; production never delegates DNS or redirects to global fetch. */
export const safeFetchNetwork = {
  resolve: (hostname: string): Promise<Address[]> =>
    lookup(hostname, { all: true, verbatim: true }),
  request: (
    url: URL,
    address: Address,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: "GET",
          agent: false,
          signal,
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "identity",
          },
          // Keep hostname/SNI/TLS validation, but pin the connection to the vetted address.
          lookup: (_hostname, options, callback) =>
            options.all
              ? callback(null, [address])
              : callback(null, address.address, address.family),
        },
        (response) => {
          response.on("error", reject);
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined)
              headers.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
          }
          if (Number(headers.get("content-length")) > maxBytes) {
            response.destroy(new SafeFetchError("too_large"));
            reject(new SafeFetchError("too_large"));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > maxBytes)
              response.destroy(new SafeFetchError("too_large"));
            else chunks.push(chunk);
          });
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      request.on("socket", (socket) => {
        socket.once("secureConnect", () => {
          if (!socket.remoteAddress || !publicAddress(socket.remoteAddress))
            request.destroy(new SafeFetchError("unsafe_destination"));
        });
      });
      request.on("error", reject);
      request.end();
    }),
};

export async function safeFetch(
  input: string,
  options: {
    maxRedirects?: number;
    maxBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<Reply & { url: string }> {
  const { maxRedirects = 0, maxBytes = 65536, timeoutMs = 10000 } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) =>
    controller.signal.addEventListener(
      "abort",
      () => reject(new SafeFetchError("timeout")),
      { once: true },
    ),
  );
  try {
    let url = new URL(input);
    for (let hops = 0; ; hops++) {
      if (url.protocol !== "https:") throw new SafeFetchError("non_https");
      if (
        url.username ||
        url.password ||
        (url.port && url.port !== "443") ||
        url.hash
      )
        throw new SafeFetchError("unsafe_destination");
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await Promise.race([safeFetchNetwork.resolve(hostname), aborted]);
      const address = addresses[0];
      if (!address || addresses.some(({ address }) => !publicAddress(address)))
        throw new SafeFetchError("unsafe_destination");
      const reply = await Promise.race([
        safeFetchNetwork.request(url, address, controller.signal, maxBytes),
        aborted,
      ]);
      if (reply.body.length > maxBytes) throw new SafeFetchError("too_large");
      if (![301, 302, 307, 308].includes(reply.status))
        return { ...reply, url: url.href };
      if (maxRedirects === 0) throw new SafeFetchError("redirects_disallowed");
      if (hops >= maxRedirects) throw new SafeFetchError("too_many_redirects");
      const location = reply.headers.get("location");
      if (!location) throw new SafeFetchError("invalid_redirect");
      try {
        url = new URL(location, url);
      } catch {
        throw new SafeFetchError("invalid_redirect");
      }
    }
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    throw new SafeFetchError(
      controller.signal.aborted ? "timeout" : "fetch_failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}
