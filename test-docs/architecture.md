# Payments Platform Architecture

Back to the [index](index.md). See also the [security assessment](security-report.md#findings).

## Overview

The platform accepts card and bank payments through a gateway, authorises them with external processors, and records every movement in a double-entry ledger.

```mermaid
flowchart LR
  subgraph Edge
    CDN[CDN / WAF] --> GW[API Gateway]
  end
  subgraph Core["Core services"]
    GW --> AUTH[Auth Service]
    GW --> PAY[Payments Service]
    PAY --> RISK[Risk Engine]
    PAY --> ROUTER[Processor Router]
    ROUTER --> P1[(Processor A)]
    ROUTER --> P2[(Processor B)]
    ROUTER --> P3[(Processor C)]
    PAY --> LEDGER[Ledger Service]
    LEDGER --> DB[(Ledger DB)]
    PAY --> OUTBOX[(Outbox)]
    OUTBOX --> BUS{{Event Bus}}
    BUS --> NOTIFY[Notifications]
    BUS --> RECON[Reconciliation]
    BUS --> ANALYTICS[Analytics]
    RECON --> LEDGER
    RISK --> FEAT[(Feature Store)]
    AUTH --> IDP[Identity Provider]
  end
  subgraph Ops["Operations"]
    ANALYTICS --> WH[(Warehouse)]
    WH --> BI[Dashboards]
    NOTIFY --> EMAIL[Email]
    NOTIFY --> SMS[SMS]
    NOTIFY --> HOOKS[Merchant Webhooks]
  end
```

## Services

### API Gateway

Terminates TLS, enforces rate limits and routes requests. Configuration lives in `gateway/routes.yaml`.

### Payments Service

Owns the payment state machine.

```mermaid
stateDiagram-v2
  [*] --> Created
  Created --> Authorising: submit
  Authorising --> Authorised: approved
  Authorising --> Declined: declined
  Authorising --> Failed: timeout
  Authorised --> Captured: capture
  Authorised --> Voided: void
  Captured --> PartiallyRefunded: refund (partial)
  Captured --> Refunded: refund (full)
  PartiallyRefunded --> Refunded: refund (rest)
  Declined --> [*]
  Failed --> Created: retry
  Voided --> [*]
  Refunded --> [*]
```

### Ledger Service

Every movement is two entries that sum to zero.

```ts
export interface Entry {
  account: AccountId;
  amount: Money; // positive = debit, negative = credit
  journalId: string;
}

export function post(journal: Entry[]): void {
  const sum = journal.reduce((s, e) => s + e.amount.minor, 0);
  if (sum !== 0) throw new Error(`Unbalanced journal: ${sum}`);
  db.insertMany(journal);
}
```

## Data flow

A card payment from checkout to settlement:

```mermaid
sequenceDiagram
  autonumber
  participant C as Checkout
  participant G as Gateway
  participant P as Payments
  participant R as Risk
  participant X as Processor
  participant L as Ledger
  participant B as Event Bus
  C->>G: POST /payments
  G->>P: create(payment)
  P->>R: score(payment)
  R-->>P: score=0.12 (allow)
  P->>X: authorise(card, amount)
  X-->>P: approved (auth code)
  P->>L: post(authorisation hold)
  P->>B: PaymentAuthorised
  P-->>G: 201 Created
  G-->>C: payment id, status
  Note over P,X: Capture happens later, when the order ships
  C->>G: POST /payments/{id}/capture
  G->>P: capture(id)
  P->>X: capture(auth code)
  X-->>P: captured
  P->>L: post(capture)
  P->>B: PaymentCaptured
```

## Deployment

```mermaid
flowchart TB
  dev[Developer] -->|push| ci[CI pipeline]
  ci --> test[Unit + contract tests]
  test --> img[Build image]
  img --> stg[Staging]
  stg --> canary[Canary 5%]
  canary -->|SLOs green| prod[Production]
  canary -->|SLO breach| rollback[Automatic rollback]
```

### Environments

| Environment | Region | Replicas | Database | Notes |
| --- | --- | ---: | --- | --- |
| dev | eu-west-1 | 1 | shared Postgres | Reset nightly |
| staging | eu-west-1 | 2 | Postgres 16 | Production-like data volumes |
| production | eu-west-1, eu-central-1 | 6 | Postgres 16 (multi-AZ) | Active-active |

## Class model

```mermaid
classDiagram
  class Payment {
    +String id
    +Money amount
    +Status status
    +authorise()
    +capture()
    +refund(Money)
  }
  class Money {
    +long minor
    +String currency
  }
  class Refund {
    +String id
    +Money amount
  }
  Payment "1" --> "*" Refund
  Payment --> Money
  Refund --> Money
```

## A broken diagram

The next block has a syntax error on purpose:

```mermaid
flowchart LR
  A --> B -->
```

## Open questions

1. Should reconciliation run per processor or globally?
2. Do we need a separate store for disputes?
