# Intent Classification Product Part

This module is a pure, rule-based MVP for classifying short customer messages into operational intents.

It is deterministic and has no side effects. It does not call external APIs, AI providers, databases, messaging providers, or environment variables.

## Current Approach

The first version uses simple keyword matching. It is intentionally small so teams can test routing behavior before introducing an LLM or hybrid classifier.

Inputs can optionally include a `vertical` field. The first vertical vocabulary is `services`, which adds Kepler-style service request language for pest control, cleaning, urgent help, and technician visits.

Future versions can replace or augment the rules with:

- LLM classification
- hybrid rule + model scoring
- tenant-specific vocabularies
- confidence thresholds
- feedback loops from real outcomes

## Intended Uses

- SaanaOS: order creation, repeat orders, and order status routing
- Kepler Services: service request and support routing
- Agents: conversation routing before selecting a workflow or tool

## Example

Input:

```text
I want the same order as last time
```

Output:

```ts
{
  intent: "order_repeat",
  confidence: 0.92,
  reason: "matched keyword: same order",
}
```

## Services Examples

Input:

```text
I need pest control for my building
```

Output:

```ts
{
  intent: "quote_request",
  confidence: 0.9,
  reason: "matched keyword: pest control",
}
```

Input:

```text
Can you send technician tomorrow?
```

Output:

```ts
{
  intent: "booking",
  confidence: 0.89,
  reason: "matched keyword: technician",
}
```

Input:

```text
We have cockroaches urgent
```

Output:

```ts
{
  intent: "support",
  confidence: 0.91,
  reason: "matched keyword: urgent",
}
```

Urgency words are checked before quote keywords for the `services` vertical, so urgent service messages route to support first.
