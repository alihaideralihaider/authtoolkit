# Lead Follow-Up Agent

## What It Does

Follows up with newly captured leads through configured channels, tracks response state, and prompts the team when a lead needs attention.

## Why It May Matter

Most small business lead loss happens after the first inquiry. A reusable follow-up agent can improve conversion without requiring a full CRM.

## Where It Fits

- AuthToolkit: reusable workflow and API layer for lead follow-up automation.
- SaanaOS: restaurant customer follow-up, missed order recovery, and campaign reminders.
- Kepler Services: follow-up after pest control or cleaning inquiries.
- Missed-call recovery agent: continue recovery after the initial missed-call message.

## Possible API Endpoint

`POST /api/product-parts/lead-followup/run`

## Possible Database Tables

- `lead_followup_runs`
- `lead_followup_events`
- `lead_followup_messages`
- `lead_followup_preferences`

## MVP Version

Accept a lead, choose a safe follow-up template, return the recommended next message and due time.

## MVP Implementation Status

- Pure rule engine implemented.
- No persistence.
- No messaging adapter.
- Safe to test locally.

## Later Advanced Version

Multi-channel sequencing, SLA tracking, owner assignment, CRM sync, reply detection, and conversion analytics.
