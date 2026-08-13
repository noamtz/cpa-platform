# Questionnaire State Machine — Visual Diagrams

These are the Mermaid diagrams from [QUESTIONNAIRE_STATE_MACHINE.md](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/docs/QUESTIONNAIRE_STATE_MACHINE.md), rendered as graphics.

---

## Full State Diagram

```mermaid
flowchart TD
    START([Client opens questionnaire link]) --> LOAD[Load: client + token + active template]

    LOAD --> AUTH{Token valid?}
    AUTH -- No --> ERROR[Show error screen]
    AUTH -- Yes --> COMPLETED_CHECK{submission.completed_at set?}

    COMPLETED_CHECK -- Yes --> LOAD_HIST["Load template snapshot from submission.template_id"]
    LOAD_HIST --> SHOW_DONE["Show completion screen - read-only summary"]

    COMPLETED_CHECK -- "No / null" --> USE_CURRENT[Use current active template]
    USE_CURRENT --> FILTER["filterStepsByClientConditions based on client.osek_type"]

    FILTER --> OSEK{osek_type set?}
    OSEK -- No --> ALL_STEPS["Include all steps - no condition filtering"]
    OSEK -- "osek murshe" --> INCLUDE_PENSION["Include conditional steps e.g. pension"]
    OSEK -- "osek patur" --> EXCLUDE_COND[Exclude osek_murshe-only steps]

    ALL_STEPS --> RESUME
    INCLUDE_PENSION --> RESUME
    EXCLUDE_COND --> RESUME

    RESUME[Compute resume step index] --> HAS_RESPONSES{"Any responses or signed PDFs?"}
    HAS_RESPONSES -- No --> WELCOME[Show welcome screen]
    HAS_RESPONSES -- Yes --> FIRST_UNANSWERED[Find first unanswered step]

    FIRST_UNANSWERED --> ALL_ANSWERED{"All steps answered?"}
    ALL_ANSWERED -- Yes --> SHOW_DONE
    ALL_ANSWERED -- No --> RACE_CHECK{"step_completed > firstUnanswered?"}
    RACE_CHECK -- Yes --> TRUST_SERVER["Trust step_completed - race condition guard"]
    RACE_CHECK -- No --> FIRST_UNANSWERED_STEP[Resume at first unanswered step]
    TRUST_SERVER --> STEP_N[Show step N]
    FIRST_UNANSWERED_STEP --> STEP_N

    STEP_N --> ANSWER_TYPE{Step response type}

    ANSWER_TYPE -- "yes/no / upload / text / select" --> REGULAR_STEP[Client answers step]
    ANSWER_TYPE -- "pdf_sign + skip_question=false" --> PDF_YES_NO[Show Yes/No first]
    ANSWER_TYPE -- "pdf_sign + skip_question=true" --> PDF_DIRECT[Go directly to sign flow]

    PDF_YES_NO -- "answer=false" --> SKIP_PDF["Mark step as not relevant - count as answered"]
    PDF_YES_NO -- "answer=true" --> PDF_SIGN_FLOW
    PDF_DIRECT --> PDF_SIGN_FLOW

    PDF_SIGN_FLOW["Navigate to /questionnaire/sign PdfSignPage"] --> PDF_RESULT{Client signs?}
    PDF_RESULT -- Complete --> SIGNED_COMPLETE["signed_pdfs record saved incomplete=false"]
    PDF_RESULT -- "Saved incomplete" --> SIGNED_INCOMPLETE["signed_pdfs record saved incomplete=true"]
    PDF_RESULT -- Abandoned --> BACK_TO_STEP[Return to step without record]

    SIGNED_COMPLETE --> RETURN_FROM_SIGN["Return to questionnaire via location.state"]
    SIGNED_INCOMPLETE --> RETURN_FROM_SIGN
    BACK_TO_STEP --> STEP_N

    RETURN_FROM_SIGN --> MERGE_SIGNED[Merge signed_pdfs into submission state]
    MERGE_SIGNED --> STEP_N

    REGULAR_STEP --> SAVE["Save via updateClientSubmission queue-based"]
    SAVE --> NEXT_STEP{Last step?}
    NEXT_STEP -- No --> STEP_N
    NEXT_STEP -- Yes --> HANDLE_COMPLETE

    HANDLE_COMPLETE["handleComplete - set completed_at + step_completed"] --> SUBMISSION_DONE["Submission.completed_at = now Client.status = completed"]
    SUBMISSION_DONE --> SHOW_DONE
```

---

## Template Change Edge Cases

```mermaid
flowchart TD
    USE_CURRENT[Use current active template] --> TEMPLATE_CHANGED{"Template updated since submission started?"}
    TEMPLATE_CHANGED -- "New steps added" --> ORPHAN["Old responses kept - New steps show as unanswered"]
    TEMPLATE_CHANGED -- "Steps removed" --> FILTER_ORPHAN["Responses for removed steps are silently stripped"]
    TEMPLATE_CHANGED -- "Step IDs unchanged but content changed" --> STALE_TITLE["Saved response uses title/emoji from saved time"]
    ORPHAN --> RESUME[Continue to resume logic]
    FILTER_ORPHAN --> RESUME
    STALE_TITLE --> RESUME
```

---

## Dashboard Progress Calculation

```mermaid
flowchart TD
    DASH_LOAD([CPA Dashboard loads]) --> DASH_TEMPLATE["Load current active template - not the historical snapshot"]
    DASH_TEMPLATE --> DASH_FILTER["filterStepsByClientConditions using client.osek_type"]
    DASH_FILTER --> DASH_PROGRESS["getStepProgress: count answered steps / total"]

    DASH_PROGRESS --> PROGRESS_RULES{Step type}
    PROGRESS_RULES -- regular --> REG_COUNT["Count if response.answer is not undefined"]
    PROGRESS_RULES -- pdf_sign --> PDF_COUNT["Count if: signed_pdfs record exists OR answer === false"]

    PDF_COUNT --> PROGRESS_PCT["progress %"]
    REG_COUNT --> PROGRESS_PCT

    PROGRESS_PCT --> STATUS_DISPLAY{"progress === 100 and no CPA override?"}
    STATUS_DISPLAY -- Yes --> DISPLAY_COMPLETED["Show completed badge + Enable approve button"]
    STATUS_DISPLAY -- No --> DISPLAY_IN_PROGRESS["Show in-progress badge + % bar"]
```

---

## CPA Status Override Pipeline

```mermaid
flowchart LR
    DISPLAY_COMPLETED["Completed - 100%"] --> CPA_ACTION{"CPA clicks Approve"}
    CPA_ACTION --> READY_IRA["cpa_status = ready_for_ira"]
    READY_IRA --> CPA_REVIEW{"CPA clicks Mark as Filed"}
    CPA_REVIEW --> REVIEWED["cpa_status = reviewed"]
    REVIEWED --> FINAL(["End of pipeline"])
```
