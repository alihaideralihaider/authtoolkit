# Reminder Retention Agent

## What It Does

Schedules reminders and retention messages for customers based on service history, due dates, or inactivity.

## Why It May Matter

Retention workflows produce repeat revenue and are useful across restaurants, services, subscriptions, and appointments.

## Where It Fits

- AuthToolkit: generic reminder rules and retention workflow API.
- SaanaOS: reorder reminders, promo nudges, and customer winback.
- Kepler Services: recurring service reminders for cleaning and pest control.
- Missed-call recovery agent: follow-up reminders when a recovery message gets no response.

## Possible API Endpoint

`POST /api/product-parts/reminders/schedule`

## Possible Database Tables

- `reminder_rules`
- `reminder_jobs`
- `reminder_events`
- `retention_segments`

## MVP Version

Calculate the next reminder due time and return a message draft.

## Later Advanced Version

Recurring schedules, suppression windows, opt-out handling, segmentation, A/B tests, and channel orchestration.

