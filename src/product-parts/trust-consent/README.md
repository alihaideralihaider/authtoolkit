# Trust / Consent Product Part

This module is a pure decision engine for checking whether an action is allowed, blocked, or needs review before outbound communication or automation happens.

It does not send messages, call APIs, write to a database, or read environment variables.

## Policy

Outbound messaging is deny-by-default. Actions such as `send_sms`, `send_whatsapp`, and `send_email` require explicit valid consent for the same channel.

A missed call alone is not consent.

Valid consent may come from sources such as:

- IVR press 1
- checkout opt-in
- web form opt-in
- manual consent entry with audit context

Denied consent blocks contact. Stale, missing, or unclear consent requires consent to be requested again before messaging.

## Intended Use

- AuthToolkit: reusable trust and consent gate before product actions
- SaanaOS: SMS, WhatsApp, email, order, and customer automation checks
- Kepler Services: service-request follow-up and human escalation safety
- Agents: preflight check before tools, messages, bookings, or escalations

## Examples

### SMS With Missing Consent

```ts
evaluateTrustConsent({
  action: "send_sms",
  channel: "sms",
});
```

Returns:

```ts
{
  decision: "blocked",
  reason: "Outbound messaging requires explicit consent.",
  requiredAction: "request_consent",
}
```

### SMS With IVR Press 1 Consent

```ts
evaluateTrustConsent({
  action: "send_sms",
  channel: "sms",
  consent: {
    status: "valid",
    channel: "sms",
    source: "ivr_press_1",
  },
});
```

Returns:

```ts
{
  decision: "allowed",
  reason: "Valid matching consent is present.",
  requiredAction: "none",
}
```

### Create Order With Suspicious Phone

```ts
evaluateTrustConsent({
  action: "create_order",
  riskSignals: {
    suspiciousPhone: true,
  },
});
```

Returns:

```ts
{
  decision: "needs_review",
  reason: "Suspicious phone activity requires review.",
  requiredAction: "manual_review",
}
```
