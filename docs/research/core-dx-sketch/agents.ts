// THROWAWAY: app composition over a proposed, domain-free core driver seam.
import { ToolLoopAgent, isStepCount } from "ai";
import { WorkflowAgent } from "@ai-sdk/workflow"; // Later evaluation only.
import { core, type AgentDriver } from "@/core"; // Proposed API, not implemented.

export const fakeExternalDriver: AgentDriver<void> = {
  run: async ({ turnId }) => ({ reply: `Acknowledged ${turnId}`, prepared: undefined }),
}; // Domain-free stand-in for a remote call; not an A2A implementation.

function hostedDriver(Engine = ToolLoopAgent) {
  return { run: async (turn) => {
    const loop = new Engine({
      model: app.assistantModel, instructions: app.assistantInstructions,
      tools: app.domainTools(turn.scope), // Reads + prepared actions, never writes.
      stopWhen: isStepCount(app.maxAgentSteps),
    });
    return app.prepareDriverResult(await loop.generate({ messages: turn.messages }), turn.turnId);
  } }; // { reply, prepared }; core carries prepared data without interpreting it.
}
export const assistant = core.defineAgent({
  operatorId: app.operatorId, agentId: "assistant", driver: hostedDriver(),
}); // Fill the Mat's Assistant is this Operator's Agent.

export async function durableHostedTurn(turnId: string) {
  "use workflow"; // Optional bounded run, NOT the initial job implementation.
  const turn = await core.loadTurnStep(turnId); // Rebuild scoped, serializable input.
  const result = await hostedDriver(WorkflowAgent).run(turn);
  return await core.commitTurnStep(turnId, result); // Calls commit.ts as ONE DB step.
} // Existing jobs call assistant.driver.run, then the same commit; no SDK authority.
