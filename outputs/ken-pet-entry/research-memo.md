# Pet care competition analysis

The strongest provisional entry is a portable handover for a family changing vets. Its central distinction is evidence: a prescription records an intention, a purchase records a transaction, and a caregiver's confirmation records a reported action. Preserving those differences could help the next vet understand the history without making the family reconstruct it.

This is a product hypothesis, not a customer finding. Original research has not yet been supplied. The next decision is whether a real owner and a receiving vet demonstrate that this distinction matters enough to change their behavior.

## What the competition rewards

The official brief asks for a consumer insight, a concrete agent workflow and a specific dependency on payments, logistics or voice. Its five published judging dimensions are evidence, creativity, clarity, feasibility and thoroughness. It does not publish numeric weights. Q2 is read first, and supporting proof is optional but scored. A polished solution cannot compensate for representing a hypothesis as a discovered customer insight.[1]

Registration closed on 8 September. Solution Assembly closes on 10 September 2026 at 11:59 p.m. IST. Eligibility requires a completed eligible team registration; that has not yet been confirmed. The round requires no code. The current submission page says the track locks on submission, so use that operational instruction even though broader terms describe track changes differently.[1][2]

AI assistance is permitted under the terms; invented interviews or research are not. Every interview needs informed consent, including notice that the submitted material may be published. Use anonymous age-band and city attribution in public-facing extracts, and remove unrelated information from supporting artifacts.[1][2]

## What is already in the opening

The pet opening already identifies changing vets, fragmented records, repetitive care, household coordination failures and the burden of manually maintaining history. It explicitly calls for continuity and minimal data entry. The proposed standard is that a new vet can see the history in under a minute. Those points establish the problem; repeating them is not an original discovery.[1]

The opening reports eleven respondents. That is an organizer sample, not the team's research, a representative market survey, or a basis for estimating market size. The displayed share of teams choosing the opening is a changing participation measure; it says nothing about the quality of competitors.

A more useful investigation asks what information changes the receiving vet's next action, who possesses it, and why it fails to travel. The answer could be treatment actually administered, a previous adverse experience, an unrecorded interruption, or something entirely different. The team should listen before selecting one.

## Three possible starting points

| Starting point | Specific job | Evidence needed | Main weakness |
|---|---|---|---|
| Change of vet | Give the receiving vet a brief they can use immediately | A recent transfer with a consequential information gap | Could be solved by an organized PDF |
| Owner away or boarding | Transfer routines and authority to a temporary caregiver | A handover where tacit knowledge or unclear authority caused rework | Episodic use and strong informal alternatives |
| Recurring household care | Make responsibility and reported completion visible | Repeated failures caused by assumed ownership, not forgotten reminders | Frequent logging may create more work |

Start with the change of vet because it has a defined trigger, recipient and completion condition. Keep boarding as an adjacent use case. Do not combine all three into an all-purpose pet assistant before demonstrating one useful loop.

This recommendation should change if interviews show that owners already transfer records effectively, vets ignore structured summaries, or the actual failure is entirely about routine delegation.

## The distinction that could matter

A single pet timeline should preserve the type and origin of each event.

| Event state | What it establishes | What it does not establish |
|---|---|---|
| Prescribed | A clinician issued an instruction | The household followed it |
| Purchased | An order or payment occurred | The product reached the animal |
| Delivered | A logistics event reports arrival | Anyone administered the product |
| Owner reported | An identified owner describes an action | Independent clinical verification |
| Provider confirmed | An identified provider confirms a specified event | Overall treatment effectiveness |
| Unknown or disputed | Information is missing or inconsistent | Permission to infer a convenient answer |

These states should coexist when appropriate. A prescription can be followed by several reported administrations; a later correction should retain the previous version and source. A provider confirming an earlier prescription cannot prove that an owner administered it at home.

The hypothesis is that preserving this distinction improves a handover. It is not a claim that all owners confuse these states or that a vet can make clinical decisions from a summary alone.

## How the proposed agent works

An owner requests a handover when changing vets. They share a pet-specific folder and authorize named contacts and a named receiving clinic. The agent extracts a timeline, attaches source references and presents unresolved items for correction.

Where consent and contact permissions exist, it asks the previous provider for narrowly defined missing information. The call identifies its automated role and purpose. Critical details are read back. If a detail remains unclear, the record says so and requests the original document or a professional correction. The product does not infer a dose, recommend a treatment, or treat silence as agreement.

The receiving vet sees the reason for transfer, relevant history, current instructions as documented, reported administration, recent tests and unresolved questions. Source documents remain one action away. Viewing originals is normal professional practice, not a product failure.

The operational endpoint is acknowledgement of receipt by the receiving vet or clinic. That does not imply clinical endorsement of every fact or successful treatment. If acknowledgement is unavailable, the product reports delivery and the lack of acknowledgement separately. No provider API is assumed; a permissioned link or human confirmation is sufficient for an initial pilot.

## The competitive reality

Supertails already offers online consultations and a post-consultation package containing records, a treatment plan, prescriptions and a health report. Its app description includes stored medical history and recurring care reminders. It also describes follow-up through a Pet Relationship Manager on WhatsApp.[3][4]

That is a serious overlap. Claims such as “India has no pet records app,” “pet owners cannot receive digital prescriptions,” or “Supertails only sells food” would be wrong. The proposal must earn its place through the quality and portability of the handover, including information originating outside a single provider network.

Public product descriptions do not establish the absence of export, outside-document ingestion or equivalent provider-verification features. The defensible statement is that the full proposed workflow has not been verified in the reviewed public material. A product demonstration could narrow or remove the gap.

Supertails is the strongest Q9 choice because its existing service relationship makes the opportunity plausible. The proposed explanation is an incentive hypothesis: independent handovers may generate less immediate commercial return than consultations and product purchases within a provider's own network. Integration effort and verification responsibility are alternative explanations. None is represented as management's stated rationale.

The simplest competing product is an organized folder or PDF prepared by the owner. The pilot must compare against that competent alternative. Beating a messy chat thread is an undemanding test.

## What each partner actually contributes

Pine Labs documents payment orders, payment links, refunds and other payment functions. These can support approved consultation or replenishment transactions. They do not establish whether a clinical service happened as described. A merchant relationship and integration are still required; the product cannot pay any clinic merely because a payments API exists.[5]

Delhivery's developer material describes shipment creation, pickup and tracking capabilities. The useful contribution is shipment status for eligible goods from integrated merchants. Do not promise emergency medical delivery, transport of live animals, universal merchant coverage or medical cold-chain handling from generic logistics documentation.[6]

Gnani describes multilingual voice agents that connect to workflows and escalate to people; its public API material includes speech recognition. That supports a low-effort capture channel. It does not establish an existing pet-care protocol, clinically reliable terminology recognition, authenticated veterinary identity, or portable signed handovers.[7][8]

Competition sandbox access is separate from public feature documentation. The team has not tested any partner integration. Public availability should never be presented as a tested prototype.

## The voice capability to request

The proposed request is a verifiable confirmation exchange. At the end of a consented provider call, the voice rail should produce a structured event linking the confirmed fields to the relevant utterances, confirmation time and verified participant identity. Corrections should replace the operative value without erasing the earlier evidence.

The reason to involve Gnani is that ambiguity appears during speech capture. A generic transcript and a later database entry can lose whether the speaker corrected a number, qualified a statement or declined to confirm it. The partner question is how to preserve that confirmation state at the point of conversation.

Ordinary speech-to-text, a webhook, a database and reminder calls are existing components, not the innovation. The team still owns the pet-event schema, access rules and receiving-vet view. If Gnani already supports field-level confirmation and evidence references, the team should identify the remaining constraint instead of insisting the capability is novel.

The requested identity assurance must be defined honestly. Calling a familiar phone number does not by itself authenticate a veterinarian. An initial pilot can enroll participating clinics and use verified clinic contacts; broader provider verification remains an adoption and operating question. A digital signature proves the origin and integrity of a record, not the clinical truth of its contents.

Payments and logistics are possible later supporting capabilities. Q4 should explicitly state that neither is required for the initial digital handover. The voice rail is the main dependency to investigate because the source information may exist only in a provider conversation. Adding commerce later would require a distinct customer need and merchant integration.

## Customer permission and provider participation

The initial asset is one voluntarily shared pet folder, not an entire family WhatsApp account. Owners can select documents and messages, name the receiving provider, and authorize specific follow-up contacts. Sharing a useful packet should not depend on granting unlimited access to personal communications.

The proposed exchange is immediate: the owner supplies fragmented material and receives a usable handover. A later step can request new permissions when the purpose changes, such as creating a sitter's temporary brief. Sharing should expire or be revocable where the product can enforce it; already downloaded copies cannot be magically recalled.

Providers need a reason to participate. A concise correction request may be less effort than repeated owner calls, but that is a hypothesis. Measure the time and response rate. If confirmations require unpaid administrative work with little benefit to the previous clinic, a phone-first design can still fail.

## A fast evidence session

Speak to someone who recently changed vets or transferred pet-care responsibility. A second conversation with a vet can challenge the owner's interpretation. One conversation may yield a useful insight; it does not establish how common the behavior is.

Begin with an accurate consent explanation: participation is voluntary; the team is preparing a competition entry; anonymous excerpts or agreed artifacts may be submitted and published by The Ken; recording is optional. Do not record or submit identifiable material beyond what the person agrees to share.

Use incident-based prompts:

1. Describe the last time another person or clinic took over care.
2. Show the documents or messages used in that handover, if comfortable.
3. Reconstruct what the next person asked that the existing material did not answer.
4. Explain what you did next and what it cost in effort or delay.
5. Describe a record that looked complete but needed correction.
6. Explain what would make you refuse a request to share or verify information.

Do not ask whether someone “would use an AI pet assistant” as the main research question. Agreement with a pitch is weak evidence. Do not introduce the prescribed-versus-administered hypothesis until after the person has described the incident unaided.

Capture the date, participant age band and city if offered, context, consent scope, exact excerpt, and any agreed artifact. Separate what the participant said from what the team inferred. An audio timestamp or the relevant raw note helps the judges trace the inference.

## How to turn evidence into sixty words

Use four elements: behavior, underlying reason, consequence and design change. Spend most of the answer on the surprising relationship and the resulting design decision. Avoid using scarce words on generic statements about a growing pet market.

A candidate observation earns its place only if it changes a step. If uncertainty about administered treatment is observed, separate it from prescriptions. If previous clinics will not respond, avoid a loop that requires their response. If owners withhold records because of unrelated personal content, introduce selective sharing. These are conditional examples, not findings.

Reject an insight that merely renames the opening's known pain. “Records are scattered,” “owners feel guilty,” and “vets change clinics” are already in the brief. A new adjective does not create new evidence.

## Pilot and decision rules

Proposed pilot: five consenting owner handovers across two willing practices, followed by a second batch only if the workflow is useful. These are recruitment targets, not completed research or promised access. First test retrieval and comprehension using real records with appropriate permission; do not let an unvalidated summary determine treatment.

Compare the proposed handover with an organized PDF containing the same underlying documents. Alternate presentation order where practical to reduce learning effects. Ask a vet to identify documented current instructions, the most recent relevant event and unresolved information, checking answers against the originals.

Track owner preparation time, provider-contact time, response rate, correction frequency, receiving-vet use, comprehension time and unresolved details. The under-one-minute target comes from the competition's aspiration and remains untested. Report small-sample results as such.

Illustrative gates to agree before testing: at least four of five owners complete a packet with no more than ten minutes of active preparation; at least four receiving assessments locate the agreed facts within sixty seconds without a critical mismatch; no unconfirmed value appears as confirmed. These are proposed product thresholds, not statistical proof.

Pause and repair the process after any critical transcription or attribution error. Reconsider the wedge if provider confirmations routinely arrive after the appointment, owners must still rebuild everything manually, or the organized PDF performs as well with less effort. A vet checking source documents is expected; the failure is avoidable reconstruction or misleading compression.

## Commercial logic without invented numbers

The candidate customer is a household facing a real transfer of care. A per-handover payment may fit episodic use better than a subscription, but willingness to pay is unknown. Ask about a recent purchase decision and test an actual offer only after demonstrating value. Do not infer an acceptable price from the emotional importance of a pet.

Contribution per completed handover equals collected revenue minus voice minutes, transcription and processing, human verification, support, provider incentives and payment costs. Include unsuccessful provider calls and abandoned handovers in the cost allocation. Acquisition cost and repeat use determine whether positive contribution can sustain a business.

Break-even volume equals fixed operating cost divided by positive contribution per handover. If contribution is negative, additional volume worsens the result. No tariff, price, market size or margin has been assumed in the submission.

The possible durable advantage is accumulated, permissioned correction history and provider acceptance. A document store alone is easy to reproduce. Portability also reduces lock-in; the company must earn repeat use through reliable service rather than making records difficult to leave with.

## How consulting discipline improves the answers

McKinsey's public preparation material supplies sample cases with reasoning and suggested answers. Bain's public interview guidance emphasizes structured problem solving and practical recommendations. These are useful writing disciplines, not The Ken's judging rules or evidence of an official consulting-firm competition template.[9][10]

Lead with the specific choice. Support it with the decisive fact. Explain the mechanism. State the condition that would change the recommendation. In a thirty-word answer, this may be one sentence; in the supporting analysis, it may require a comparison and a test.

Use verbs that expose action: request, assemble, verify, correct, authorize, deliver, acknowledge and revoke. Use technical terms only when they name a real requirement. Remove claims such as world-class, seamless, revolutionary, holistic and game-changing unless they serve a concrete purpose; here they do not.

Do not force a market-size exhibit or a standard strategy framework into a question asking for one customer asset. Precision comes from answering the actual question within its limit. Originality comes from an observed contradiction and its consequence for the design.

## Final editorial tests

For every answer, check whether it could be pasted unchanged into another team's submission. If it could, find the specific actor, event or decision that is missing. Q1 needs real access; Q2 needs real discovery; Q3 needs a finite loop; Q4 needs honest rail roles; Q5 needs a specific unresolved capability; Q6 needs a bounded permission exchange; Q7 needs inherited advantage; Q8 needs a sincere value; Q9 needs company-specific facts and a labeled inference; Q10 needs a deliberate track selection.

The current proposal is strongest on scope, workflow and competitive realism. Its decisive weakness is the absence of first-hand research. The next useful work is a real conversation and an evidence-driven revision, not more decorative language.

## Sources

All web materials reviewed on 10 September 2026. Publication dates are not assumed where unavailable.

1. The Ken, [Case Competition 2026](https://the-ken.com/case-competition-2026/), including the Looking after the pet opening and Solution Assembly instructions; read in the public browser page.
2. The Ken, [Case Competition Terms and Conditions](https://the-ken.com/case-competition-2026/terms-and-conditions/), effective 14 August 2026.
3. Supertails, [Online Vet Consultation](https://supertails.com/pages/consult-a-vet), service and post-consultation deliverables.
4. Supertails, [Supertails Your One Stop Pet Clinic Pharmacy and Store](https://supertails.com/blogs/healthcare/supertails-your-one-stop-pet-clinic-pharmacy-store), app records, reminders and follow-up support.
5. Pine Labs, [Online Payments API Reference](https://www.pinelabs.com/docs/online-payments/api), payment functions and authentication.
6. Delhivery, [Client Developer Portal](https://help.delhivery.com/home/docs/client-developer-portal-1), logistics integration and staging access.
7. Gnani, [Voice Bots and Multilingual Agents](https://www.gnani.ai/resources/blogs/what-is-a-voice-bot-from-ivrs-to-multilingual-agents-that-listen-understand-and-act), voice workflow capabilities.
8. Gnani, [API Service Documentation](https://gnani-ai.github.io/API-service/), speech recognition and access requirements.
9. McKinsey, [Getting Ready for Your Interviews](https://www.mckinsey.com/careers/interviewing), public case preparation and sample reasoning.
10. Bain, [Interview Preparation](https://www.bain.com/careers/interview-preparation/experience-interview.aspx), public preparation guidance; used as writing discipline, not competition rules.
