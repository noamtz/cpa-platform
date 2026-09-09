# Privacy-safe operational analytics

AuditFlow uses exactly `posthog-js@1.428.6` for a small set of operational workflow milestones. The browser adapter
sends data only to the PostHog Cloud EU ingestion host `https://eu.i.posthog.com`, and only when
`VITE_POSTHOG_KEY` is non-empty. A blank or missing key disables SDK loading and all analytics requests.

## Ownership

- The AuditFlow product owner owns the meaning of the event contract and authorizes analytics enablement.
- The repository maintainers own the adapter, call sites, tests, and this dictionary. An event-schema change must
  update all four in the same pull request.
- The PostHog Cloud EU project owner creates or rotates the public project key and controls project access and
  retention settings. No secret or personal API key belongs in the browser configuration.
- The GitHub Environment owner controls `VITE_POSTHOG_KEY` separately in the `test` and `production` Environments,
  including reviewer and deployment protections. Production configuration and deployment require their normal
  explicit authorization.

## Privacy contract

- Collection is manual: autocapture, page views, page leaves, dead clicks, exception capture, performance capture,
  heatmaps, campaign/referrer storage, feature payloads, surveys, experiments, tours, conversations, and session
  recording are disabled.
- Identity is an anonymous random PostHog `distinct_id` stored only in `sessionStorage`. The application never calls
  `identify`, never creates a person profile, and never supplies a user, CPA, client, submission, template, or
  document identifier.
- Forbidden data includes names, email addresses, phone numbers, entity records, client/submission/user/owner/step
  identifiers, years, questionnaire answers or progress, filenames, sizes, content types, file contents or locations,
  templates, generated PDFs, signatures, routes, query strings, URLs, referrers, IP addresses, geolocation, device or
  browser attributes, user-agent data, session IDs, authentication tokens, signed URLs, headers, cookies, campaign
  data, raw errors, messages, stacks, timestamps, durations, counts, and arbitrary nested objects.
- Unknown events, properties, and enum values are dropped. A final `before_send` allowlist reconstructs the payload
  after SDK enrichment and removes every browser- or SDK-added field not explicitly documented below.
- Analytics loading, initialization, storage, capture, and transport failures are ignored and cannot block product
  state, persistence, navigation, progress reporting, or existing error handling.
- Sentry remains a separate operational control and is unchanged by this integration.

## Event contract

Every event requires `outcome`, whose value is exactly `success` or `failure`. A failure also requires
`failure_category`; a success must omit it. “Success” always means the durable product boundary named below was
acknowledged, not merely that a button was clicked or a request began. “Failure” means that attempt rejected or its
required persistence acknowledgement returned false.

| Event | Precise trigger | Owner | Required properties | Conditional property |
| --- | --- | --- | --- | --- |
| `cpa_sign_in` | Cognito callback completion immediately before redirect succeeds, or callback processing rejects. | Authentication flow maintainer | `outcome` | `failure_category` on failure |
| `questionnaire_start` | The welcome action opens the first step after an acknowledged new or reusable submission, or that preparation fails. | Public questionnaire maintainer | `outcome` | `failure_category` on failure |
| `questionnaire_resume` | Initial public loading recognizes an incomplete submission that was already started. This event has no separate failure emission. | Public questionnaire maintainer | `outcome=success` | None |
| `questionnaire_complete` | The final public completion save is acknowledged, returns false, or rejects. | Public questionnaire maintainer | `outcome` | `failure_category` on failure |
| `file_upload` | The shared two-phase upload completes its initiate, signed PUT, and completion acknowledgement, or any of those stages rejects. | Private-file service maintainer | `outcome`, `surface` (`public` or `cpa`) | `failure_category` on failure |
| `pdf_generate` | PDF generation in the active signing submission flow resolves to a Blob or rejects. | PDF/signing maintainer | `outcome` | `failure_category` on failure |
| `pdf_sign` | Required-field validation blocks submission, signed-record persistence fails, or persistence is acknowledged successfully. | PDF/signing maintainer | `outcome` | `failure_category` on failure |
| `cpa_workflow_complete` | A CPA-assisted questionnaire completion save or the `ready_for_filing`/`filed` status transition is acknowledged or fails. | CPA workflow maintainer | `outcome`, `milestone` (`assisted_questionnaire`, `ready_for_filing`, or `filed`) | `failure_category` on failure |

Invented enum-only examples:

```js
captureOperationalEvent("file_upload", {
  outcome: "failure",
  surface: "public",
  failure_category: "transport",
});

captureOperationalEvent("cpa_workflow_complete", {
  outcome: "success",
  milestone: "ready_for_filing",
});
```

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

## SDK ingestion envelope

At the final send boundary, the adapter retains these SDK-issued fields in addition to the application properties:

- `properties.token`: the configured public PostHog project key, retained only when it exactly matches
  `VITE_POSTHOG_KEY`; it routes the event to the project and is not an application authentication token.
- `properties.distinct_id`: the random anonymous session-scoped identifier required by PostHog ingestion.
- `properties.$lib` and `properties.$lib_version`: non-empty SDK name/version strings.
- `properties.$process_person_profile`: the literal `false`, enforcing the no-profile contract.
- top-level `uuid`: the SDK-generated event deduplication identifier.

Application code cannot set or override these through the public capture API. Client timestamps, `$time`,
`$session_id`, `$window_id`, `$device_id`, URLs, device context, and every other enrichment are removed. PostHog may
record its server-side receipt time, but AuditFlow does not send a client event timestamp.

## Delivery expectations

Analytics is best-effort and is never a source of truth. Captures are scheduled after the corresponding product
boundary without awaiting delivery. Events normally appear after PostHog processes the request, but there is no
latency SLA; operators should allow several minutes before treating a query as suspicious. Events can be lost when
the key is blank or invalid, storage or SDK loading is blocked, a browser closes, the client is offline, an extension
blocks PostHog, the privacy guard rejects an envelope, or transport/ingestion fails. Product behavior must remain
correct in every such case.

## Enablement, disablement, and key rotation

1. The PostHog owner creates or selects an EU Cloud project and provides only its public project key.
2. The GitHub Environment owner sets `VITE_POSTHOG_KEY` in the intended Environment and runs the normal authorized
   deployment. Local developers may set the same variable in their ignored local environment file.
3. To disable collection, blank or remove `VITE_POSTHOG_KEY` in that Environment and redeploy. Confirm that the built
   application makes no PostHog SDK or ingestion request.
4. To rotate projects or keys, replace the Environment value with the new EU public key, redeploy, verify only the
   synthetic queries below in the new project, and then revoke or archive the old project configuration as required.
   Never place either key in this repository, issue text, logs, screenshots, or captured payload examples.

## Safe verification

Use invented workflow actions only. Inspect the browser network request to confirm the EU host, the absence of
forbidden fields, and best-effort behavior; never copy a project key or event payload into project artifacts. In
PostHog, use only event/property names in saved queries:

- count each of the eight event names grouped by `outcome`;
- count `file_upload` grouped by `surface` and `outcome`;
- count `cpa_workflow_complete` grouped by `milestone` and `outcome`;
- count failures grouped by `failure_category`;
- verify successes have no `failure_category` and no event has properties outside this dictionary.

If a query needs a customer value, identifier, route, filename, timestamp, or free-text filter, the query is outside
this analytics contract and must not be created.
