import { EventEmitter } from "node:events";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { safeFetch, safeFetchNetwork } from "./safe-fetch";

const httpsRequest = vi.hoisted(() => vi.fn());
vi.mock("node:https", () => ({ request: httpsRequest }));

afterEach(() => vi.restoreAllMocks());

it("fetches a public HTTPS document through an address-pinned transport without credentials", async () => {
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  const request = vi.spyOn(safeFetchNetwork, "request").mockResolvedValue({
    status: 200,
    headers: new Headers({ "Content-Type": "application/json" }),
    body: Buffer.from("{}"),
  });
  const result = await safeFetch(
    "https://school.example/.well-known/poppy.json",
  );
  expect(result.body.toString()).toBe("{}");
  expect(request).toHaveBeenCalledWith(
    new URL("https://school.example/.well-known/poppy.json"),
    { address: "93.184.216.34", family: 4 },
    expect.any(AbortSignal),
    65536,
  );
});

it("pins DNS when Node asks for all addresses, and keeps TLS hostname validation enabled", async () => {
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  httpsRequest.mockImplementation((_url, options, callback) => {
    const request = new EventEmitter();
    Object.assign(request, {
      end: () =>
        queueMicrotask(() => {
          options.lookup(
            "school.example",
            { all: true },
            (error: Error | null, addresses: unknown) => {
              if (error || !Array.isArray(addresses)) {
                request.emit(
                  "error",
                  new Error("Node requires an array for all-address lookup"),
                );
                return;
              }
              expect(addresses).toEqual([
                { address: "93.184.216.34", family: 4 },
              ]);
              expect(options.rejectUnauthorized).not.toBe(false);
              expect(options.headers).toEqual({
                Accept: "application/json",
                "Accept-Encoding": "identity",
              });
              const response = new IncomingMessage(new Socket());
              response.statusCode = 200;
              response.headers = { "content-type": "application/json" };
              callback(response);
              response.emit("data", Buffer.from("{}"));
              response.emit("end");
            },
          );
        }),
    });
    return request;
  });
  expect(
    (await safeFetch("https://school.example/poppy.json")).body.toString(),
  ).toBe("{}");
});

it.each([
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "100.64.0.1",
  "172.16.0.1",
  "192.168.1.1",
  "::1",
  "fe80::1",
  "fc00::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
])("rejects unsafe DNS destination %s before connecting", async (address) => {
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address, family: address.includes(":") ? 6 : 4 },
  ]);
  const transport = vi.spyOn(safeFetchNetwork, "request");
  await expect(
    safeFetch("https://school.example/poppy.json"),
  ).rejects.toMatchObject({ code: "unsafe_destination" });
  expect(transport).not.toHaveBeenCalled();
});

it("rejects mixed public/private DNS responses rather than falling back to a private address", async () => {
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await expect(
    safeFetch("https://school.example/poppy.json"),
  ).rejects.toMatchObject({ code: "unsafe_destination" });
});

it.each([
  "https://user:password@school.example/file",
  "https://school.example:8443/file",
  "https://2130706433/file",
  "https://[::1]/file",
])("rejects credentials, unsafe ports and disguised IPs in %s", async (url) => {
  const transport = vi.spyOn(safeFetchNetwork, "request");
  await expect(safeFetch(url)).rejects.toMatchObject({
    code: "unsafe_destination",
  });
  expect(transport).not.toHaveBeenCalled();
});

it("does not follow redirects for agent metadata and keys by default", async () => {
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  vi.spyOn(safeFetchNetwork, "request").mockResolvedValue({
    status: 302,
    headers: new Headers({ location: "https://other.example/file" }),
    body: Buffer.from(""),
  });
  await expect(safeFetch("https://school.example/file")).rejects.toMatchObject({
    code: "redirects_disallowed",
  });
});

it("revalidates DNS at each redirect and caps the entire chain", async () => {
  const resolve = vi
    .spyOn(safeFetchNetwork, "resolve")
    .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.spyOn(safeFetchNetwork, "request").mockResolvedValue({
    status: 307,
    headers: new Headers({ location: "https://other.example/file" }),
    body: Buffer.from(""),
  });
  resolve
    .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
    .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
  await expect(
    safeFetch("https://school.example/file", { maxRedirects: 5 }),
  ).rejects.toMatchObject({ code: "unsafe_destination" });
  await expect(
    safeFetch("https://school.example/file", { maxRedirects: 5 }),
  ).rejects.toMatchObject({ code: "too_many_redirects" });
});

it("bounds actual bytes even if the peer omits Content-Length", async () => {
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  vi.spyOn(safeFetchNetwork, "request").mockResolvedValue({
    status: 200,
    headers: new Headers(),
    body: Buffer.alloc(65537),
  });
  await expect(safeFetch("https://school.example/file")).rejects.toMatchObject({
    code: "too_large",
  });
});

it("bounds DNS time, not just the HTTP request", async () => {
  vi.spyOn(safeFetchNetwork, "resolve").mockImplementation(
    () => new Promise(() => {}),
  );
  await expect(
    safeFetch("https://school.example/file", { timeoutMs: 5 }),
  ).rejects.toMatchObject({ code: "timeout" });
});

it("aborts a transport that connects to a private address despite a public lookup", async () => {
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  httpsRequest.mockImplementation(() => {
    const request = new EventEmitter();
    return Object.assign(request, {
      destroy: (error: Error) => request.emit("error", error),
      end: () =>
        queueMicrotask(() => {
          const socket = Object.assign(new EventEmitter(), {
            remoteAddress: "127.0.0.1",
          });
          request.emit("socket", socket);
          socket.emit("secureConnect");
        }),
    });
  });
  await expect(safeFetch("https://school.example/file")).rejects.toMatchObject({
    code: "unsafe_destination",
  });
});

it.each([true, false])(
  "rejects oversized streamed HTTP bodies safely (declared length: %s)",
  async (declaredLength) => {
    vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
    httpsRequest.mockImplementation((_url, _options, callback) =>
      Object.assign(new EventEmitter(), {
        end: () =>
          queueMicrotask(() => {
            const response = new IncomingMessage(new Socket());
            response.statusCode = 200;
            response.headers = declaredLength ? { "content-length": "4" } : {};
            callback(response);
            if (!declaredLength) {
              response.emit("data", Buffer.from("1234"));
            }
          }),
      }),
    );
    await expect(
      safeFetch("https://school.example/file", { maxBytes: 3 }),
    ).rejects.toMatchObject({ code: "too_large" });
  },
);
