import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET as metadata } from "@/app/.well-known/oauth-authorization-server/schools/[schoolId]/route";
import { GET as discovery } from "@/app/poppy/discovery/[schoolId]/[domain]/route";
import { listSchoolDomains } from "@/lib/poppy/domains";
import { safeFetchNetwork } from "@/lib/poppy/safe-fetch";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { IDLE_STATE } from "./form-state";
import {
  checkPoppyDomainAction,
  connectPoppyDomainAction,
  removePoppyDomainAction,
} from "./poppy-actions";

const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => ({ id: auth.id, email: "owner@local.test" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

loadLocalEnv();
const sql = authSql();
const ownerId = randomUUID();
const ownerB = randomUUID();
const suffix = randomUUID();
const domain = `school-${suffix}.example`;
let schoolId = "";
let schoolB = "";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.fillthemat.example");
  vi.stubEnv("POPPY_AUTH_ORIGIN", "https://auth.fillthemat.example");
  auth.id = ownerId;
  ({ schoolId } = await seedSchool(sql, {
    ownerId,
    slug: `poppy-${suffix.slice(0, 8)}`,
    name: "Poppy School",
    offerings: [{ name: "Trial" }],
  }));
  ({ schoolId: schoolB } = await seedSchool(sql, {
    ownerId: ownerB,
    slug: `poppy-b-${suffix.slice(0, 8)}`,
    name: "Other School",
    offerings: [{ name: "Trial" }],
  }));
});
afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await deleteSchoolOwner(sql, ownerB);
  await sql.end();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  for (const [owner, id] of [
    [ownerB, schoolB],
    [ownerId, schoolId],
  ]) {
    auth.id = owner ?? "";
    for (const connection of await listSchoolDomains(id ?? "")) {
      await removePoppyDomainAction(
        IDLE_STATE,
        form({ domain: connection.domain }),
      );
    }
  }
  await connectPoppyDomainAction(IDLE_STATE, form({ domain }));
});
afterEach(() => vi.restoreAllMocks());

async function verifyBaseline() {
  const target = `https://app.fillthemat.example/poppy/discovery/${schoolId}/${domain}`;
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(async (url) => ({
    status: url.hostname === domain ? 302 : 200,
    headers: new Headers(url.hostname === domain ? { location: target } : {}),
    body: Buffer.from("{}"),
  }));
  expect(
    (await checkPoppyDomainAction(IDLE_STATE, form({ domain }))).status,
  ).toBe("success");
}

describe("School Owner domain connection", () => {
  it("checks www separately and shows its failure without overriding the apex verification", async () => {
    const target = `https://app.fillthemat.example/poppy/discovery/${schoolId}/${domain}`;
    const requested: string[] = [];
    const request = vi
      .spyOn(safeFetchNetwork, "request")
      .mockImplementation(async (url) => {
        requested.push(url.href);
        return {
          status:
            url.hostname === domain
              ? 302
              : url.hostname === `www.${domain}`
                ? 404
                : 200,
          headers: new Headers(
            url.hostname === domain ? { location: target } : {},
          ),
          body: Buffer.from("{}"),
        };
      });
    expect(
      (await checkPoppyDomainAction(IDLE_STATE, form({ domain }))).status,
    ).toBe("success");
    expect(requested).toContain(`https://www.${domain}/.well-known/poppy.json`);
    expect((await listSchoolDomains(schoolId))[0]).toMatchObject({
      state: "verified",
      wwwLastCheckResult: "http_error",
    });
    request.mockImplementation(async (url) => ({
      status:
        url.hostname === `www.${domain}`
          ? 302
          : url.hostname === domain
            ? 404
            : 200,
      headers: new Headers(
        url.hostname === `www.${domain}` ? { location: target } : {},
      ),
      body: Buffer.from("{}"),
    }));
    expect(
      (await checkPoppyDomainAction(IDLE_STATE, form({ domain }))).status,
    ).toBe("error");
    expect((await listSchoolDomains(schoolId))[0]).toMatchObject({
      state: "failing",
      lastCheckResult: "http_error",
      wwwLastCheckResult: "passed",
    });
  });

  it("adds a normalized pending domain with exact instructions and copy, but does not expose discovery", async () => {
    const result = await connectPoppyDomainAction(
      IDLE_STATE,
      form({ domain: `WWW.${domain.toUpperCase()}`, schoolId: randomUUID() }),
    );
    expect(result.status).toBe("success");
    const [connection] = await listSchoolDomains(schoolId);
    expect(connection).toMatchObject({
      domain,
      state: "pending",
      sourceUrl: `https://${domain}/.well-known/poppy.json`,
      discoveryUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/poppy/discovery/${schoolId}/${domain}`,
    });
    expect(JSON.parse(connection?.document ?? "")).toMatchObject({
      protocol_version: "0.1",
      organization: { name: "Poppy School", domain },
      auth: { issuer: `https://auth.fillthemat.example/schools/${schoolId}` },
    });
    const response = await discovery(
      new Request(connection?.discoveryUrl ?? ""),
      { params: Promise.resolve({ schoolId, domain }) },
    );
    expect(response.status).toBe(404);
  });

  it("verifies an HTTPS redirect chain, exposing pending discovery only during its own check", async () => {
    const target = `https://app.fillthemat.example/poppy/discovery/${schoolId}/${domain}`;
    vi.spyOn(safeFetchNetwork, "request").mockImplementation(async (url) => {
      if (url.hostname === domain)
        return {
          status: 301,
          headers: new Headers({
            location: "https://redirect.school.example/poppy",
          }),
          body: Buffer.from(""),
        };
      if (url.hostname === "redirect.school.example")
        return {
          status: 308,
          headers: new Headers({ location: target }),
          body: Buffer.from(""),
        };
      const response = await discovery(new Request(target), {
        params: Promise.resolve({ schoolId, domain }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return {
        status: response.status,
        headers: response.headers,
        body: Buffer.from(await response.text()),
      };
    });
    const result = await checkPoppyDomainAction(IDLE_STATE, form({ domain }));
    expect(result.status).toBe("success");
    const response = await discovery(new Request(target), {
      params: Promise.resolve({ schoolId, domain: `www.${domain}` }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toMatchObject({
      organization: { domain },
      auth: { issuer: `https://auth.fillthemat.example/schools/${schoolId}` },
    });
    expect(await listSchoolDomains(schoolId)).toMatchObject([
      {
        domain,
        state: "verified",
        mode: "redirect",
        lastCheckResult: "passed",
      },
    ]);
    // Next's internal Request URL may be localhost behind a reverse proxy.
    const internal = await discovery(
      new Request(
        `http://localhost:3030/poppy/discovery/${schoolId}/${domain}`,
        {
          headers: {
            host: "app.fillthemat.example",
            "x-forwarded-host": "attacker.example",
          },
        },
      ),
      { params: Promise.resolve({ schoolId, domain }) },
    );
    expect(internal.status).toBe(200);
    expect(await internal.json()).toMatchObject({
      auth: { issuer: `https://auth.fillthemat.example/schools/${schoolId}` },
    });
  });

  it("keeps a hosted JSON copy valid after a School rename, but requires every other field and JSON content type", async () => {
    const [connection] = await listSchoolDomains(schoolId);
    const copy = JSON.parse(connection?.document ?? "");
    await sql`update app.schools set name = 'Renamed School' where id = ${schoolId}`;
    try {
      const request = vi.spyOn(safeFetchNetwork, "request");
      request.mockResolvedValue({
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: Buffer.from(JSON.stringify(copy)),
      });
      expect(
        (await checkPoppyDomainAction(IDLE_STATE, form({ domain }))).status,
      ).toBe("success");
      for (const [body, contentType] of [
        [
          JSON.stringify({ ...copy, protocol_version: "different" }),
          "application/json",
        ],
        ["not JSON", "application/json"],
        [JSON.stringify(copy), "text/plain"],
        [
          JSON.stringify({ ...copy, organization: { domain } }),
          "application/json",
        ],
      ]) {
        request.mockResolvedValue({
          status: 200,
          headers: new Headers({ "content-type": contentType }),
          body: Buffer.from(body ?? ""),
        });
        expect(
          (await checkPoppyDomainAction(IDLE_STATE, form({ domain }))).status,
        ).toBe("error");
      }
    } finally {
      await sql`update app.schools set name = 'Poppy School' where id = ${schoolId}`;
    }
  });

  it("accepts an exact JSON copy, lists only live domains in issuer metadata, and removes bindings immediately", async () => {
    await verifyBaseline();
    const copyDomain = `copy-${suffix}.example`;
    await connectPoppyDomainAction(IDLE_STATE, form({ domain: copyDomain }));
    const copy = (await listSchoolDomains(schoolId)).find(
      (row) => row.domain === copyDomain,
    );
    vi.spyOn(safeFetchNetwork, "request").mockResolvedValue({
      status: 200,
      headers: new Headers({
        "content-type": "application/json; charset=utf-8",
      }),
      body: Buffer.from(copy?.document ?? ""),
    });
    expect(
      (await checkPoppyDomainAction(IDLE_STATE, form({ domain: copyDomain })))
        .status,
    ).toBe("success");
    await connectPoppyDomainAction(
      IDLE_STATE,
      form({ domain: `pending-${suffix}.example` }),
    );
    const metadataUrl = `https://auth.fillthemat.example/.well-known/oauth-authorization-server/schools/${schoolId}`;
    const response = await metadata(new Request(metadataUrl), {
      params: Promise.resolve({ schoolId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      issuer: `https://auth.fillthemat.example/schools/${schoolId}`,
      token_endpoint: `https://auth.fillthemat.example/schools/${schoolId}/token`,
      revocation_endpoint: `https://auth.fillthemat.example/schools/${schoolId}/revoke`,
      poppy_domains: [copyDomain, domain],
    });
    expect(
      (await removePoppyDomainAction(IDLE_STATE, form({ domain: copyDomain })))
        .status,
    ).toBe("success");
    expect(
      (
        await discovery(new Request(copy?.discoveryUrl ?? ""), {
          params: Promise.resolve({ schoolId, domain: copyDomain }),
        })
      ).status,
    ).toBe(404);
    expect(
      await (
        await metadata(new Request(metadataUrl), {
          params: Promise.resolve({ schoolId }),
        })
      ).json(),
    ).toMatchObject({ poppy_domains: [domain] });
  });

  it.each([
    ["no_redirect", "No redirect", 200, "text/html", "", ""],
    ["non_https", "HTTPS", 302, "text/html", "http://school.example/poppy", ""],
    [
      "wrong_destination",
      "wrong destination",
      302,
      "text/html",
      "https://wrong.school.example/poppy",
      "",
    ],
    ["copy_mismatch", "copy does not match", 200, "application/json", "", "{}"],
  ])(
    "explains %s without publishing the pending domain",
    async (reason, message, status, contentType, location, body) => {
      const failingDomain = `${reason.replaceAll("_", "-")}-${suffix}.example`;
      await connectPoppyDomainAction(
        IDLE_STATE,
        form({ domain: failingDomain }),
      );
      vi.spyOn(safeFetchNetwork, "request").mockImplementation(async (url) => ({
        status: url.hostname === failingDomain ? Number(status) : 200,
        headers: new Headers({
          "content-type": String(contentType),
          ...(location && url.hostname === failingDomain
            ? { location: String(location) }
            : {}),
        }),
        body: Buffer.from(String(body)),
      }));
      const result = await checkPoppyDomainAction(
        IDLE_STATE,
        form({ domain: failingDomain }),
      );
      expect(result.status).toBe("error");
      expect(result.fieldErrors.domain).toBe(reason);
      expect(result.message).toContain(message);
      expect(
        (
          await discovery(
            new Request(
              `https://app.fillthemat.example/poppy/discovery/${schoolId}/${failingDomain}`,
            ),
            { params: Promise.resolve({ schoolId, domain: failingDomain }) },
          )
        ).status,
      ).toBe(404);
    },
  );

  it("does not let another School claim a live domain, or remove the owner's binding", async () => {
    await verifyBaseline();
    auth.id = ownerB;
    await connectPoppyDomainAction(IDLE_STATE, form({ domain }));
    const copy = (await listSchoolDomains(schoolB)).find(
      (row) => row.domain === domain,
    );
    vi.spyOn(safeFetchNetwork, "request").mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      body: Buffer.from(copy?.document ?? ""),
    });
    const result = await checkPoppyDomainAction(IDLE_STATE, form({ domain }));
    expect(result.fieldErrors.domain).toBe("claimed_by_another_school");
    await removePoppyDomainAction(IDLE_STATE, form({ domain, schoolId }));
    const metadataUrl = `https://auth.fillthemat.example/.well-known/oauth-authorization-server/schools/${schoolId}`;
    expect(
      await (
        await metadata(new Request(metadataUrl), {
          params: Promise.resolve({ schoolId }),
        })
      ).json(),
    ).toMatchObject({ poppy_domains: [domain] });
  });

  it("returns 404 for unknown School ids, unknown domains, pending-only Schools and wrong origins", async () => {
    await verifyBaseline();
    for (const id of [randomUUID(), "not-a-uuid", schoolB]) {
      expect(
        (
          await metadata(
            new Request(
              `https://auth.fillthemat.example/.well-known/oauth-authorization-server/schools/${id}`,
            ),
            { params: Promise.resolve({ schoolId: id }) },
          )
        ).status,
      ).toBe(404);
    }
    for (const [origin, id, requestedDomain] of [
      ["https://app.fillthemat.example", randomUUID(), domain],
      ["https://app.fillthemat.example", schoolId, "unknown.school.example"],
      ["https://attacker.example", schoolId, domain],
    ]) {
      expect(
        (
          await discovery(
            new Request(`${origin}/poppy/discovery/${id}/${requestedDomain}`, {
              headers: {
                host: new URL(origin ?? "").host,
                "x-forwarded-host": "app.fillthemat.example",
              },
            }),
            {
              params: Promise.resolve({
                schoolId: id ?? "",
                domain: requestedDomain ?? "",
              }),
            },
          )
        ).status,
      ).toBe(404);
    }
    expect(
      (
        await metadata(
          new Request(
            `https://app.fillthemat.example/.well-known/oauth-authorization-server/schools/${schoolId}`,
          ),
          { params: Promise.resolve({ schoolId }) },
        )
      ).status,
    ).toBe(404);
  });

  it("keeps a verified domain live after a failed re-check for maintenance to handle", async () => {
    await verifyBaseline();
    vi.spyOn(safeFetchNetwork, "request").mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: Buffer.from("No discovery"),
    });
    expect(
      (await checkPoppyDomainAction(IDLE_STATE, form({ domain }))).status,
    ).toBe("error");
    expect(
      (await listSchoolDomains(schoolId)).find((row) => row.domain === domain),
    ).toMatchObject({ state: "failing", consecutiveFailures: 0 });
    const target = `https://app.fillthemat.example/poppy/discovery/${schoolId}/${domain}`;
    expect(
      (
        await discovery(new Request(target), {
          params: Promise.resolve({ schoolId, domain }),
        })
      ).status,
    ).toBe(200);
    const metadataUrl = `https://auth.fillthemat.example/.well-known/oauth-authorization-server/schools/${schoolId}`;
    expect(
      await (
        await metadata(new Request(metadataUrl), {
          params: Promise.resolve({ schoolId }),
        })
      ).json(),
    ).toMatchObject({ poppy_domains: [domain] });
  });

  it("fences a check against removing the domain while its network request is running", async () => {
    const removed = `removed-${suffix}.example`;
    await connectPoppyDomainAction(IDLE_STATE, form({ domain: removed }));
    const target = `https://app.fillthemat.example/poppy/discovery/${schoolId}/${removed}`;
    vi.spyOn(safeFetchNetwork, "request").mockImplementation(async (url) => {
      if (url.hostname === removed) {
        await removePoppyDomainAction(IDLE_STATE, form({ domain: removed }));
        return {
          status: 302,
          headers: new Headers({ location: target }),
          body: Buffer.from(""),
        };
      }
      return { status: 200, headers: new Headers(), body: Buffer.from("{}") };
    });
    expect(
      (await checkPoppyDomainAction(IDLE_STATE, form({ domain: removed })))
        .fieldErrors.domain,
    ).toBe("not_found");
    expect(
      (
        await discovery(new Request(target), {
          params: Promise.resolve({ schoolId, domain: removed }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await listSchoolDomains(schoolId)).some((row) => row.domain === removed),
    ).toBe(false);
  });

  it("lets exactly one School win concurrent passing checks for the same domain", async () => {
    const contested = `contested-${suffix}.example`;
    await connectPoppyDomainAction(IDLE_STATE, form({ domain: contested }));
    auth.id = ownerB;
    await connectPoppyDomainAction(IDLE_STATE, form({ domain: contested }));
    const context = new AsyncLocalStorage<string>();
    vi.spyOn(safeFetchNetwork, "request").mockImplementation(async (url) => ({
      status: url.hostname === contested ? 302 : 200,
      headers: new Headers(
        url.hostname === contested
          ? {
              location: `https://app.fillthemat.example/poppy/discovery/${context.getStore()}/${contested}`,
            }
          : {},
      ),
      body: Buffer.from("{}"),
    }));
    auth.id = ownerId;
    const a = context.run(schoolId, () =>
      checkPoppyDomainAction(IDLE_STATE, form({ domain: contested })),
    );
    auth.id = ownerB;
    const b = context.run(schoolB, () =>
      checkPoppyDomainAction(IDLE_STATE, form({ domain: contested })),
    );
    const results = await Promise.all([a, b]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "error",
      "success",
    ]);
    expect(
      results.find((result) => result.status === "error")?.fieldErrors.domain,
    ).toBe("claimed_by_another_school");
    for (const id of [schoolId, schoolB]) {
      auth.id = id === schoolId ? ownerId : ownerB;
      await removePoppyDomainAction(IDLE_STATE, form({ domain: contested }));
    }
  });

  it("turns Poppy off when the last live domain is removed, and allows a new School to claim it", async () => {
    await verifyBaseline();
    await removePoppyDomainAction(IDLE_STATE, form({ domain }));
    const metadataUrl = `https://auth.fillthemat.example/.well-known/oauth-authorization-server/schools/${schoolId}`;
    expect(
      (
        await metadata(new Request(metadataUrl), {
          params: Promise.resolve({ schoolId }),
        })
      ).status,
    ).toBe(404);
    auth.id = ownerB;
    await connectPoppyDomainAction(IDLE_STATE, form({ domain }));
    const copy = (await listSchoolDomains(schoolB)).find(
      (row) => row.domain === domain,
    );
    vi.spyOn(safeFetchNetwork, "request").mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      body: Buffer.from(copy?.document ?? ""),
    });
    expect(
      (await checkPoppyDomainAction(IDLE_STATE, form({ domain }))).status,
    ).toBe("success");
    expect(
      await (
        await metadata(
          new Request(
            `https://auth.fillthemat.example/.well-known/oauth-authorization-server/schools/${schoolB}`,
          ),
          { params: Promise.resolve({ schoolId: schoolB }) },
        )
      ).json(),
    ).toMatchObject({ poppy_domains: [domain] });
  });
});
