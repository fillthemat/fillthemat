# Fillthemat

The language of martial-arts schools using Fillthemat to handle trial enquiries and bookings.

## Language

**School**:
A martial-arts business that uses Fillthemat to engage with prospects. A school is the business, not its owner or any individual staff member.
_Avoid_: Academy

**School Owner**:
The person who manages a school's Fillthemat account.

**Contact**:
A person whose details a school has for communication about a trial. The contact may be different from the person attending the trial.

**Participant**:
The person attending a school's trial class. A participant may be different from the contact arranging the trial.

**Lead**:
An enquiry about a trial that the school can follow up on, associated with a contact. A lead is distinct from a booking.

**Conversation**:
An exchange of messages between a school's assistant and someone interested in a trial, over one channel. It ends after 30 days without a new message or when it reaches its message limit. An ended conversation is kept but never resumed: the next message starts a new one.

**Assistant**:
The AI that talks with people interested in a trial on a school's behalf. It answers and prepares, but never creates a booking or a lead itself.
_Avoid_: Agent, booking agent, bot, concierge

**Channel**:
The medium a conversation happens over: web chat or WhatsApp.

**Turn**:
One inbound message accepted into a conversation, together with the reply to it, whether the assistant or a deterministic platform response produced that reply. A message the platform refuses outright is not a turn.

**Booking**:
A participant's reservation for a specific trial class at a school.

**Booking Intent**:
A participant, trial offering, and trial occurrence the assistant has proposed but the person has not yet confirmed. It becomes a booking only through the platform's confirmation.
_Avoid_: Prepared booking, booking capture

**Lead Request**:
A request to be contacted that the assistant gathered from someone. It becomes a lead only after they consent.
_Avoid_: Lead capture

**Trial Offering**:
A class that a school makes available for trials, including its participant eligibility criteria.

**Trial Window**:
The recurring schedule and capacity for a trial offering.

**Trial Occurrence**:
A specific dated instance of a trial window, with its own booking capacity.

**FAQ**:
A question a school has answered in advance for people interested in a trial.

**School Catalog**:
What a school currently publishes about its trials: the trial offerings it is taking trials for, with their trial windows and trial occurrences, and its FAQs.
_Avoid_: Catalogue, school data, school info
