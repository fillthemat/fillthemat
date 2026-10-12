import { describe, expect, it } from "vitest";
import { createMetaSignupClient, MetaSignupError } from "./meta-signup";

describe("Meta signup client", () => {
  it.each([
    ["CONNECTED", "funding-196", true, true],
    ["CONNECTED", null, true, false],
    ["PENDING", "funding-196", false, true],
  ])(
    "reads registration and funding independently (%s, %s)",
    async (status, funding, registered, paymentMethod) => {
      const client = createMetaSignupClient({
        appId: "196",
        appSecret: "secret",
        fetch: async (url, init) => {
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            "Bearer school-token",
          );
          const request = new URL(String(url));
          if (request.pathname.endsWith("/phone-196")) {
            expect(request.searchParams.get("fields")).toBe(
              "status,verified_name",
            );
            return Response.json({ status, verified_name: "School profile" });
          }
          expect(request.pathname).toBe("/v26.0/account-196");
          expect(request.searchParams.get("fields")).toBe("primary_funding_id");
          return Response.json(funding ? { primary_funding_id: funding } : {});
        },
      });
      expect(
        await client.readReadiness({
          token: "school-token",
          wabaId: "account-196",
          phoneNumberId: "phone-196",
        }),
      ).toEqual({ registered, paymentMethod, profileName: "School profile" });
    },
  );
  it("rejects a WABA the popup token did not authorize even when its phone matches", async () => {
    const client = createMetaSignupClient({
      appId: "195",
      appSecret: "app-secret",
      fetch: async () =>
        Response.json({
          data: {
            is_valid: true,
            app_id: "195",
            expires_at: 0,
            granular_scopes: [
              {
                scope: "whatsapp_business_management",
                target_ids: ["another-school"],
              },
            ],
          },
        }),
    });
    expect(
      await client.validateNumber({
        token: "customer-token",
        wabaId: "19501",
        phoneNumberId: "19502",
        number: "+12125550152",
      }),
    ).toBe(false);
  });
  it("returns a sanitized failure rather than leaking a provider URL or payload", async () => {
    const client = createMetaSignupClient({
      appId: "195",
      appSecret: "app-secret",
      fetch: async () => {
        throw new Error(
          "https://graph.facebook.com/?code=secret-code&access_token=secret-token",
        );
      },
    });
    await expect(client.exchangeCode("secret-code")).rejects.toEqual(
      new MetaSignupError("signup_failed"),
    );
  });
  it("exchanges a popup code, checks its customer assets, subscribes the WABA and registers with a separate PIN", async () => {
    const requests: {
      path: string;
      body: URLSearchParams;
      authorization: string | null;
    }[] = [];
    const client = createMetaSignupClient({
      appId: "195",
      appSecret: "app-secret",
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        requests.push({
          path,
          body: new URLSearchParams(String(init?.body ?? "")),
          authorization: new Headers(init?.headers).get("Authorization"),
        });
        if (path.endsWith("/oauth/access_token"))
          return Response.json({ access_token: "customer-token" });
        if (path.endsWith("/debug_token"))
          return Response.json({
            data: {
              is_valid: true,
              app_id: "195",
              expires_at: 1800000000,
              granular_scopes: [
                {
                  scope: "whatsapp_business_management",
                  target_ids: ["19501"],
                },
              ],
            },
          });
        if (path.endsWith("/phone_numbers"))
          return Response.json({
            data: [{ id: "19502", display_phone_number: "+1 212-555-0152" }],
          });
        return Response.json({ success: true });
      },
    });
    expect(await client.exchangeCode("oauth-code")).toEqual({
      token: "customer-token",
      expiresAt: new Date("2027-01-15T08:00:00Z"),
    });
    expect(
      await client.validateNumber({
        token: "customer-token",
        wabaId: "19501",
        phoneNumberId: "19502",
        number: "+12125550152",
      }),
    ).toBe(true);
    await client.subscribe({ token: "customer-token", wabaId: "19501" });
    await client.register({
      token: "customer-token",
      phoneNumberId: "19502",
      pin: "987654",
    });
    expect(requests[0]?.body.get("code")).toBe("oauth-code");
    expect(requests.at(-2)).toMatchObject({
      path: "/v26.0/19501/subscribed_apps",
      authorization: "Bearer customer-token",
    });
    expect(requests.at(-1)).toMatchObject({
      path: "/v26.0/19502/register",
      authorization: "Bearer customer-token",
    });
    expect(requests.at(-1)?.body.get("messaging_product")).toBe("whatsapp");
    expect(requests.at(-1)?.body.get("pin")).toBe("987654");
  });
});
