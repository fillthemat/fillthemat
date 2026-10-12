import { poppyAppOrigin, schoolIssuer } from "./urls";

/** This is also the downloadable copy: no whitespace/newline reserialization. */
export function discoveryDocument(
  school: { id: string; name: string },
  domain: string,
): string {
  return JSON.stringify({
    protocol_version: "0.1",
    organization: { name: school.name, domain },
    auth: { issuer: schoolIssuer(school.id) },
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
