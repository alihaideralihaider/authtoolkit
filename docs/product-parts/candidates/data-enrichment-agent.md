# Data Enrichment Agent

## What It Does

Adds useful context to leads, accounts, or conversations from safe internal and external signals.

## Why It May Matter

Enriched records help teams prioritize, route, and personalize follow-up without manual research.

## Where It Fits

- AuthToolkit: enrichment API and normalization layer.
- SaanaOS: restaurant profile enrichment, customer context, and lead scoring.
- Kepler Services: infer property type, area, urgency, and follow-up priority.
- Missed-call recovery agent: enrich caller/account context before choosing recovery action.

## Possible API Endpoint

`POST /api/product-parts/enrichment/run`

## Possible Database Tables

- `enrichment_runs`
- `enrichment_signals`
- `enrichment_results`
- `entity_profiles`

## MVP Version

Normalize a record and return derived tags or priority scores from provided input only.

## Later Advanced Version

External data providers, confidence scoring, audit trails, enrichment freshness, and per-tenant enrichment policies.

