# Review Capture Agent

## What It Does

Requests customer reviews after a successful service, filters unhappy customers into private feedback, and routes positive customers to public review links.

## Why It May Matter

Reviews are high-value for local businesses, but manual review requests are inconsistent.

## Where It Fits

- AuthToolkit: reusable review workflow with consent and channel adapters.
- SaanaOS: post-order review requests for restaurants.
- Kepler Services: post-service review capture after cleaning or pest control jobs.
- Missed-call recovery agent: not primary, but could request reviews after recovered jobs complete.

## Possible API Endpoint

`POST /api/product-parts/review-capture/request`

## Possible Database Tables

- `review_requests`
- `review_feedback`
- `review_destinations`
- `review_events`

## MVP Version

Generate a review request message and return a destination URL based on customer status.

## Later Advanced Version

Sentiment gate, Google review integration, per-location routing, reminders, suppression rules, and reporting.

