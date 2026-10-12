# Core

The language of agents holding conversations for a business over many channels, independent of what that business sells. Fill the Mat is one application built on it.

## Language

### Who

**Operator**:
The business an agent acts for. Every agent, conversation and channel connection belongs to exactly one operator.
_Avoid_: Tenant, customer, account

**Staff**:
A person who acts for an operator: configuring its agents, taking control of conversations, and talking to its operator agent.
_Avoid_: Operator (for the person), admin, user

**Agent**:
An AI that holds conversations for an operator under a given configuration. An operator may have more than one.
_Avoid_: Bot, assistant (in core)

**Operator Agent**:
An agent that staff talk to about how their operator's agents are configured and how they have performed.

**Counterpart**:
Whoever is on the other side of a conversation from an agent: a person or a personal agent, possibly anonymous. A counterpart is known only by its identity on one channel.
_Avoid_: User, customer, contact (in core)

**Personal Agent**:
An AI acting for a counterpart, outside the operator's control.

### Where

**Channel**:
The medium a conversation happens over.

**Channel Connection**:
An operator's presence on one channel, through which counterparts reach exactly one of its agents.
_Avoid_: Integration, inbox, number

### What happens

**Conversation**:
An exchange of messages between one agent and one counterpart over one channel, belonging to one operator and kept with the same agent for its whole life. An ended conversation is kept but never resumed. When a conversation ends is the operator's application's policy.
_Avoid_: Thread, session, chat

**Turn**:
One inbound message accepted into a conversation, together with the reply to it, whether the agent or a platform response produced that reply. A message refused outright is not a turn.

**Platform Response**:
A reply in a conversation produced by the platform itself rather than by the agent.

**Handoff**:
Control of a conversation passing between its agent and staff, in either direction. While staff have control, the agent does not reply.
_Avoid_: Escalation, takeover, transfer
