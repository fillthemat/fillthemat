import { after } from "next/server";
import { z } from "zod";
import { sleep } from "@/lib/sleep";
import {
  conversationReadOptions,
  poppyMessage,
  readPoppyJson,
} from "./conversation-requests";
import { completePoppyTurns } from "./conversation-turn";
import {
  acceptPoppyMessage,
  closePoppyConversation,
  getPoppyConversation,
  getPoppyConversationEvents,
  savePoppyMessageResponse,
} from "./conversations";
import { PoppyError, poppyErrorResponse } from "./errors";
import { checkPoppyRequest, type PoppyPrincipal } from "./protected-request";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function continueGeneration(id: string) {
  // Start before polling; after retains this exact promise through disconnects.
  const pending = completePoppyTurns(id).catch(() => {
    console.error(
      JSON.stringify({ event: "poppy_turn_failed", conversationId: id }),
    );
  });
  after(() => pending);
}

async function pollEvents(
  principal: PoppyPrincipal,
  id: string,
  options: ReturnType<typeof conversationReadOptions>,
  accepted = false,
) {
  const deadline = Date.now() + options.wait * 1000;
  for (;;) {
    const page = await getPoppyConversationEvents(
      principal,
      id,
      options.cursor,
    );
    if (
      Date.now() >= deadline ||
      page.status === "closed" ||
      (accepted ? page.status !== "working" : page.events.length > 0)
    )
      return page;
    await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
  }
}

export async function poppyMessageEndpoint(
  request: Request,
  schoolId: string,
  conversationId?: string,
): Promise<Response> {
  const authorization = await checkPoppyRequest(request, schoolId);
  if (!authorization.ok) return authorization.response;
  try {
    const parsed = z
      .object({ message: poppyMessage })
      .strict()
      .safeParse(await readPoppyJson(request));
    if (!parsed.success) throw new PoppyError("invalid_request");
    const options = conversationReadOptions(request);
    const accepted = await acceptPoppyMessage(
      authorization.principal,
      parsed.data.message,
      conversationId,
      options.cursor,
    );
    if (accepted.error) throw new PoppyError(accepted.error, 409);
    const id = accepted.conversationId;
    continueGeneration(id);
    const body =
      accepted.response ??
      (new URL(request.url).searchParams.has("wait")
        ? await pollEvents(authorization.principal, id, options, true)
        : // A retry returns the original acknowledgement, even after closure.
          { conversation_id: id, status: "working", responder: "agent" });
    return response(
      await savePoppyMessageResponse(accepted.messageKey, body),
      conversationId ? 202 : 201,
    );
  } catch (error) {
    return poppyErrorResponse(error, true);
  }
}

export async function poppyEventsEndpoint(
  request: Request,
  schoolId: string,
  conversationId: string,
): Promise<Response> {
  const authorization = await checkPoppyRequest(request, schoolId);
  if (!authorization.ok) return authorization.response;
  try {
    const options = conversationReadOptions(request);
    const conversation = await getPoppyConversation(
      authorization.principal,
      conversationId,
    );
    if (!conversation.endedAt && conversation.poppyStatus === "working")
      continueGeneration(conversationId);
    return response(
      await pollEvents(authorization.principal, conversationId, options),
    );
  } catch (error) {
    return poppyErrorResponse(error, true);
  }
}

export async function poppyCloseEndpoint(
  request: Request,
  schoolId: string,
  conversationId: string,
): Promise<Response> {
  const authorization = await checkPoppyRequest(request, schoolId);
  if (!authorization.ok) return authorization.response;
  try {
    const parsed = z
      .object({})
      .strict()
      .safeParse(await readPoppyJson(request));
    if (!parsed.success) throw new PoppyError("invalid_request");
    return response(
      await closePoppyConversation(authorization.principal, conversationId),
    );
  } catch (error) {
    return poppyErrorResponse(error, true);
  }
}
