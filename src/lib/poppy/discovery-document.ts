import { poppyAppOrigin, schoolIssuer } from "./urls";

/** The downloadable copy; verification ignores only organization.name. */
export function discoveryDocument(
  school: { id: string; name: string },
  domain: string,
): string {
  return JSON.stringify({
    protocol_version: "0.1",
    organization: { name: school.name, domain },
    auth: { issuer: schoolIssuer(school.id) },
    apis: [
      {
        type: "openapi",
        url: `${poppyAppOrigin()}/poppy/schools/${school.id}/openapi.json`,
        description:
          "List bookable trials, propose a booking Operation and read booking status.",
      },
    ],
    extensions: {
      operations: {
        version: "1",
        endpoint: `${poppyAppOrigin()}/poppy/schools/${school.id}/operations`,
      },
    },
    agent: {
      protocols: [
        {
          type: "poppy",
          endpoint: `${poppyAppOrigin()}/poppy/schools/${school.id}/conversations`,
        },
      ],
    },
  });
}
