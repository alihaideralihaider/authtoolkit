# Lead Follow-Up Product Part

Experimental product part for future lead follow-up automation.

This module is now a pure decision engine. It evaluates a lead follow-up input and returns a recommended action, channel, message draft, and delay.

It does not send messages. It does not call Twilio, Signal House, Supabase, email providers, routes, or environment variables. It is not wired into production.

## What It Returns

- whether follow-up is ready, blocked, needs review, or errored
- the recommended action
- the recommended channel when one can be selected
- a plain business-safe message draft
- a delay in seconds

## Examples

### Missed Call With SMS Consent

```ts
await runLeadFollowup({
  leadId: "lead_123",
  contactMethod: "sms",
  contactValue: "+15555555555",
  source: "missed_call",
  intent: "order",
  consent: {
    canMessage: true,
    channel: "sms",
  },
});
```

Returns a `ready` result with `recommendedAction: "send_initial_followup"` and an SMS message draft that starts with “sorry we missed your call”.

### No Consent

```ts
await runLeadFollowup({
  contactMethod: "sms",
  contactValue: "+15555555555",
  source: "web_form",
  consent: {
    canMessage: false,
    reason: "Customer has not opted in.",
  },
});
```

Returns `blocked` with `recommendedAction: "ask_for_consent"`.

### Missing Contact

```ts
await runLeadFollowup({
  contactMethod: "sms",
  source: "manual",
});
```

Returns `error` because `contactValue` is missing.

## Execution Layer

The rule engine decides what should happen: recommended action, channel, message draft, and timing.

The execution layer decides if that recommendation is currently allowed to happen. It enforces strict consent and cooldown rules, then returns `shouldSend` without sending anything.

Consent is deny-by-default. Outbound messaging is allowed only when `input.consent?.canMessage === true`, the consent is not marked stale or unclear, and the consent channel matches the selected outbound channel. A missed call, checkout, phone number, contact value, source, or previous customer history never implies consent by itself.

Messaging providers such as Twilio, Signal House, WhatsApp, or email adapters can be plugged in later. They are intentionally not connected here.

### Execution Examples

Missed call with consent:

```ts
await runLeadFollowupExecution({
  contactMethod: "sms",
  contactValue: "+15555555555",
  source: "missed_call",
  consent: {
    canMessage: true,
    channel: "sms",
  },
});
```

Returns `shouldSend: true`.

No consent:

```ts
await runLeadFollowupExecution({
  contactMethod: "sms",
  contactValue: "+15555555555",
  source: "missed_call",
});
```

Returns `shouldSend: false` because undefined consent is treated as no consent.

Recent contact:

```ts
await runLeadFollowupExecution({
  contactMethod: "sms",
  contactValue: "+15555555555",
  source: "missed_call",
  consent: {
    canMessage: true,
    channel: "sms",
  },
  lastContactAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
});
```

Returns `shouldSend: true` with `delaySeconds: 300`.
