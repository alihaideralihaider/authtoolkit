# Conversation Agent

## What It Does

Runs a structured customer conversation, classifies intent, asks for missing information, and returns a normalized result.

## Why It May Matter

Many products need the same intake loop: understand the request, ask one question at a time, and produce structured data.

## Where It Fits

- AuthToolkit: generic conversation runtime and state machine.
- SaanaOS: ordering, support, promotions, and restaurant customer intake.
- Kepler Services: cleaning and pest control intake assistant.
- Missed-call recovery agent: message replies after missed-call outreach.

## Possible API Endpoint

`POST /api/product-parts/conversation/respond`

## Possible Database Tables

- `conversation_sessions`
- `conversation_messages`
- `conversation_state`
- `conversation_outputs`

## MVP Version

Stateless response builder with typed input and output, no persistence.

## Later Advanced Version

Durable memory, tool calls, role configs, multilingual support, escalation, analytics, and per-tenant prompt packs.

