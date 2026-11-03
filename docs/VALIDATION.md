# Customer validation and first sale

Date: 2026-11-03. Labels: VERIFIED (checked primary source), PRACTITIONER (common industry practice, confirm in interviews), VENDOR CLAIM (vendor's own words), HYPOTHESIS (ours, untested).

## 1. Thesis

Small commercial landlords in Texas prepare CAM, tax and insurance reconciliations in spreadsheets each spring. They will pay a few hundred dollars per property for a reviewed pre-close audit in November and December that finds missing data and calculation problems before year-end, so the spring reconciliation is faster and survives tenant review. HYPOTHESIS.

Why now: calendar-year 2026 books close in January and February 2027. Reconciliation statements typically go out in the first months after year-end, and leases often give tenants a window, commonly 60 to 90 days after the statement, to dispute or audit. PRACTITIONER (rets.ai explainer). A November pre-close review sits before that rush.

## 2. Narrowest initial segment

Texas owner-operators and small third-party managers of neighborhood and strip retail centers.

- 2 to 15 properties, 20 to 150 tenants
- NNN retail leases with CAM, tax and insurance pass-throughs
- Books in QuickBooks, AppFolio or spreadsheets, with CAM worked in Excel
- No dedicated CAM staff. The owner, a bookkeeper or a controller does it
- Decision maker: owner, controller, or director of property management

Why this segment: retail NNN leases carry the most pass-through rules per tenant (HYPOTHESIS). Texas property taxes are a large pass-through line, so tax allocations matter (HYPOTHESIS, verify with interview data). Owner-operators sign their own checks, so the buying cycle is short (HYPOTHESIS).

Excluded for now: institutional owners on Yardi or MRI with in-house CAM teams, office base-year portfolios over 15 properties, medical office with complex expense stops.

## 3. Workflow Veyra supports first

Annual CAM reconciliation, as commonly practiced (PRACTITIONER, confirm in every interview):

1. Abstract lease terms: pro-rata share and its denominator, included and excluded costs, caps, base year, gross-up, admin fee.
2. Export the GL for the property and year.
3. Map GL accounts to recoverable pools: CAM, taxes, insurance.
4. Exclude nonrecoverable items: capital costs, leasing commissions, landlord overhead, as each lease defines.
5. Allocate each pool to tenants by lease method.
6. Apply caps, base years, gross-ups and admin fees.
7. Prorate partial-year tenants.
8. Compare actual share with estimates billed during the year.
9. Prepare statements showing the true-up.
10. Answer tenant questions and audits. Document corrections.

Veyra v0.1 covers steps 2 to 8 on year-to-date data, with step 1 entered as structured rules by a person. It reports what is missing for steps 1, 9 and 10. Lease interpretation stays with the client or their accountant.

## 4. Competitors

| Option | What it is | Price | Fit for this segment | Label |
| --- | --- | --- | --- | --- |
| CapVeri (capveri.com) | CAM reconciliation and billing-leakage platform working from Yardi and MRI exports | Pro shown at $588/yr on homepage | Direct overlap. Software, self-serve. Yardi/MRI focus | VENDOR CLAIM |
| STRATAFOLIO | Commercial property management and accounting with automated CAM reports, per-lease caps | Third-party listings: about $150 to $190/mo base plus per-unit fees | Requires adopting their platform | VENDOR CLAIM |
| AppFolio | Property management with CAM tracking and reconciliation | Quote-based for commercial | Third-party guides say it handles common cases only | VENDOR CLAIM |
| Re-Leased | Commercial PM platform with service charge reconciliation, Xero and QuickBooks links | Quote-based | Requires platform adoption | VENDOR CLAIM |
| Outsourced CAM providers | Done-for-you reconciliations | One provider advertises $599 to $1,299 per property per year (unverified domain) | Closest to our offer | VENDOR CLAIM |
| Neurobird | No CAM product found. Likely NeuBird, an IT operations AI company | n/a | Not a competitor | VERIFIED by search, 2026-11-03 |
| Excel templates | Free or low-cost workbooks | Free to low | The real incumbent | PRACTITIONER |

Why a customer picks Veyra over these (HYPOTHESIS, test in calls):

- No migration. We work from the exports they already have.
- A person reviews the result and signs off with them. Software competitors are self-serve.
- Pre-close timing. We do the work in November, not in March.
- Every number has a trace to a GL row and a lease rule they approved.

Not a reason: "uses AI". v0.1 uses none.

If calls show prospects already get this from their CPA at a lower price, narrow to managers with 5 or more properties who outsource bookkeeping but not CAM.

## 5. Offer

"Send us one property's 2026 year-to-date GL, tenant CAM billings and lease abstracts. Within 7 business days you get a reviewed pre-close audit: expense classification, provisional tenant allocations, a list of missing data, and potential billing discrepancies to verify, so your year-end reconciliation starts clean. No system migration."

- $499 for one property, up to 15 tenants, one period (HYPOTHESIS price)
- Includes a 30-minute review call
- Upsell: final 2026 reconciliation in January to March at $750 to $1,500 per property, credited $250 if booked by Dec 15 (HYPOTHESIS)

Exclusions: legal interpretation of lease language, more than 15 tenants, more than one period, missing source records (reported, not reconstructed), CPI or cumulative caps and other unsupported terms (flagged for manual handling), tenant communication.

Missing documents: we list what is missing and calculate everything else. We do not estimate missing values.

Legal-interpretation questions: we flag them and stop. The client or their attorney decides. We record the decision.

Sign-off: client approves the lease-rule table before calculation and the deliverable before any use. Deliverables are labeled provisional. Liability is capped at fees paid. We do not guarantee any recovery or claim any variance is an error.

Success measures for the pilot: client accepts the calculations, reports hours saved versus last year, confirms how many flagged items were real, and books the year-end reconciliation.

## 6. Seven-day validation plan (Nov 4 to Nov 10, 2026)

Budget: 2 to 4 hours per day.

| Day | Tasks | Targets | Checkpoint |
| --- | --- | --- | --- |
| 1 Tue | Build prospect list: Texas commercial property managers from TREC-licensed brokerage sites, IREM and BOMA chapter directories (San Antonio, Austin, Houston, DFW), LoopNet/Crexi listing agents for strip centers, county appraisal district owner records for retail parcels | 40 prospects with name, role, email or phone | List exists |
| 2 Wed | Finish list. Send first 30 personalized emails. 10 LinkedIn connection notes | 100 prospects, 30 emails, 10 LinkedIn | 100 rows qualified |
| 3 Thu | 30 more emails. 15 calls. Book interviews | 2 calls booked | Any reply rate under 2% after 60 sends: rewrite the message |
| 4 Fri | 2 to 3 discovery calls. Follow up day-2 sends. Ask for a redacted reconciliation | 3 conversations total | Record hours, pain, current cost |
| 5 Mon | 3 calls. Offer the $499 pilot to every qualified prospect | 6 conversations, 2 pilot offers | |
| 6 Tue | 2 to 3 calls. Send pilot agreement and invoice to anyone who said yes | 9 conversations, 1 signed or paid pilot | |
| 7 Wed | Final follow-ups. Decide | 10 conversations | Apply kill criteria |

Discovery questions:

1. Walk me through your last CAM reconciliation. Who did it, in what tool, how long did it take?
2. How many hours did you or your staff spend? Any outside accountant fees?
3. Did any tenant question or audit a statement in the last two years? What happened?
4. What lease terms cause the most work: caps, base years, gross-ups, exclusions?
5. When do you start next year's reconciliation, and what slows you down?
6. Would a pre-close review in November help, or do you only care in spring?
7. Can you share a redacted copy of last year's reconciliation?
8. If we did one property for $499 in the next two weeks, would you do it?

Cold email (first touch):

> Subject: 2026 CAM reconciliation for {property}
>
> Hi {name}, I'm building Veyra, a CAM review service for small retail portfolios in Texas. Before your 2026 books close, we review one property's year-to-date GL, CAM billings and lease terms, then send back a workbook showing provisional tenant allocations, missing data and items to verify. No software to install.
>
> How long did last year's reconciliation for {property} take your team? If it was more than a few days, I'd like 15 minutes to learn how you do it.
>
> {your name}

Follow-up (day 3): "Quick follow-up. Most owners I talk to finish CAM in March or April. If yours runs on spreadsheets, I'd like to hear how you handle caps and gross-ups. 15 minutes this week?"

Call opener: "I'm calling owners of strip centers in {city} about how they handle CAM reconciliations. Do you do them in-house or through an accountant?"

## 7. Kill criteria (set before more building)

- Fewer than 5 discovery conversations from 100 qualified prospects in 7 days: the channel or segment is wrong. Change one before spending more time.
- 10 conversations and no one describes the reconciliation as taking more than 2 days or causing disputes: the pain is too small. Stop or change segment.
- 10 conversations, a clear pain, and zero paid pilots at $499: test $299 once, then stop selling pre-close and pre-sell the January reconciliation instead.
- A pilot reveals that most leases need terms v0.1 cannot compute: stop adding engine features until two more clients confirm the same terms.
- Validation counts only signed or paid engagements. Interest and compliments do not count.

## 8. How to verify the uncertain claims

- Competitor prices: book demos with CapVeri and STRATAFOLIO and record quotes with dates.
- Outsourced provider pricing: request 3 quotes from CAM service firms.
- Dispute windows and statement timing: read 3 redacted leases from prospects.
- Texas tax share of pass-throughs: ask each prospect for the split from last year's reconciliation.

Sources checked 2026-11-03: capveri.com, stratafolio.com, getapp.com STRATAFOLIO listing, appfolio.com blog, re-leased help center and erpresearch.com listing, rets.ai blog.
