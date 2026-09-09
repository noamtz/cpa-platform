# Privacy-safe operational analytics

AuditFlow uses PostHog only for a small set of operational workflow milestones. The browser adapter sends data to
`https://eu.i.posthog.com` only when `VITE_POSTHOG_KEY` is non-empty. A blank or missing key disables SDK loading and
all analytics requests.

## Privacy contract

- Collection is manual: autocapture, page views, page leaves, dead clicks, exception capture, performance capture,
  heatmaps, campaign/referrer storage, feature payloads, surveys, experiments, tours, conversations, and session
  recording are disabled.
- Identity is an anonymous random PostHog identifier stored only in `sessionStorage`. The application never calls
  `identify` and never supplies a user, CPA, client, submission, template, or document identifier.
- Names, email addresses, phone numbers, client data, questionnaire answers, filenames, file contents or locations,
  signatures, routes, token-bearing URLs, raw errors, error messages, timestamps, durations, and counts are forbidden.
- Unknown events, properties, and enum values are dropped. A final `before_send` allowlist removes browser- and
  SDK-added URL, referrer, device, user-agent, and session properties.
- Analytics loading, initialization, storage, capture, and transport failures are ignored and cannot block product
  state, persistence, navigation, or error handling.
- Sentry remains a separate operational control and is unchanged by this integration.

## Events

Every event requires `outcome`, whose value is exactly `success` or `failure`. A failure also requires
`failure_category`; a success must omit it.

| Event | Purpose and trigger | Additional allowed properties |
|---|---|---|
| `cpa_sign_in` | Measures whether Cognito callback completion succeeds before redirect or rejects. | None |
| `questionnaire_start` | Measures whether the welcome action opens the first step after an acknowledged or reusable submission. | None |
| `questionnaire_resume` | Measures recognition of an incomplete, already-started public submission after loading. | None |
| `questionnaire_complete` | Measures whether the public completion save is acknowledged. | None |
| `file_upload` | Measures whether the shared two-phase upload reaches acknowledged completion or rejects. | `surface`: `public` or `cpa` |
| `pdf_generate` | Measures whether PDF generation in the active signing flow resolves or rejects. | None |
| `pdf_sign` | Measures required-field validation, signed-record persistence, and successful acknowledgement. | None |
| `cpa_workflow_complete` | Measures CPA-assisted questionnaire completion and final workflow transitions. | `milestone`: `assisted_questionnaire`, `ready_for_filing`, or `filed` |

## Failure categories

`failure_category` is one of:

- `authentication`
- `authorization`
- `validation`
- `not_found`
- `conflict`
- `persistence`
- `transport`
- `service`
- `unknown`

The category is derived only from a fixed workflow stage, numeric HTTP status, or standard error name. Raw exception
content is never submitted.

## SDK-reserved properties

At the final send boundary, the adapter may retain only PostHog's anonymous `$distinct_id`, `$lib`, `$lib_version`,
and a false `$process_person_profile` marker in addition to the application properties above. Application code cannot
set or override these values through the capture API.
