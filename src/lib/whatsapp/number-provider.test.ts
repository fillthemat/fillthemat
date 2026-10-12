import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAgentPhoneNumberProvider } from "./number-provider";

describe("AgentPhone number provider", () => {
  it("buys a US SMS/voice number tagged with the allocation and attached to the verification agent", async () => {
    const allocationId = randomUUID();
    const requests: { url: string; init?: RequestInit }[] = [];
    const provider = createAgentPhoneNumberProvider({
      apiKey: "test-key",
      agentId: "agt_verification",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return init?.method === "POST"
          ? Response.json({
              id: "num_test",
              phoneNumber: "+12125550145",
              country: "US",
              status: "active",
              externalId: allocationId,
              agentId: "agt_verification",
            })
          : Response.json({ data: [], hasMore: false, total: 0 });
      },
    });
    expect(
      await provider.buyUsNumber({ allocationId, schoolId: randomUUID() }),
    ).toEqual({ ok: true, number: "+12125550145", resourceId: "num_test" });
    expect(requests[0]?.url).toBe(
      `https://api.agentphone.ai/v1/numbers?externalId=${allocationId}`,
    );
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      country: "US",
      type: "sms",
      agentId: "agt_verification",
      externalId: allocationId,
    });
    expect(requests[1]?.init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
    });
  });
});
