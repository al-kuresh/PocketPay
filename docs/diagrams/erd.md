# PocketPay ER diagram

All 12 tables, generated from [`server/prisma/schema.prisma`](../../server/prisma/schema.prisma)
(column names as stored in Postgres). Money columns are `bigint` poisha (৳1 = 100). The check
constraints and triggers that guard the money tables are listed in
[design.md §8.5](../design.md#85-database-guards).

```mermaid
erDiagram
    users {
        uuid id PK
        string phone UK
        string nid_number UK "10 digits"
        string name
        date date_of_birth
        string shop_name "merchants only"
        string pin_hash "bcrypt"
        Role role "CUSTOMER | AGENT | MERCHANT | ADMIN"
        UserStatus status "PENDING_KYC | ACTIVE | FROZEN | REJECTED"
        int failed_pin_attempts
        timestamptz locked_until
        string profile_photo_key
        timestamptz created_at
        timestamptz updated_at
    }
    user_documents {
        uuid id PK
        uuid user_id FK
        DocumentKind kind "NID_FRONT | NID_BACK | SELFIE | PROFILE"
        string storage_key
        DocumentAccess access "PRIVATE | PUBLIC"
        string mime
        int size_bytes
        int width
        int height
        timestamptz created_at
    }
    kyc_submissions {
        uuid id PK
        uuid user_id FK
        uuid nid_front_id FK
        uuid nid_back_id FK
        uuid selfie_id FK
        KycStatus status "PENDING | APPROVED | REJECTED"
        uuid reviewed_by FK
        string reason
        timestamptz submitted_at
        timestamptz reviewed_at
    }
    otp_codes {
        uuid id PK
        string phone "no FK: the user doesn't exist yet"
        string code_hash
        OtpPurpose purpose "REGISTER"
        timestamptz expires_at
        int attempts
        timestamptz verified_at
        timestamptz consumed_at
        timestamptz created_at
    }
    refresh_tokens {
        uuid id PK
        uuid user_id FK
        string token_hash UK
        uuid family "one login session"
        timestamptz expires_at
        timestamptz revoked_at
        uuid replaced_by "next token in the family (no FK)"
        string user_agent
        string ip
        timestamptz created_at
    }
    audit_logs {
        uuid id PK
        uuid actor_id FK
        string action
        string target_type
        string target_id
        json metadata
        string ip
        timestamptz created_at
    }
    wallets {
        uuid id PK
        uuid user_id FK, UK "NULL for system wallets"
        WalletType type "CUSTOMER | AGENT | MERCHANT | SYSTEM_FEES | SYSTEM_FLOAT"
        bigint balance "cached; only postTransaction writes it"
        timestamptz created_at
    }
    transactions {
        uuid id PK
        string trx_id UK "human-readable"
        TransactionType type "SEND_MONEY | CASH_IN | CASH_OUT | PAYMENT | FLOAT_TOPUP"
        TransactionStatus status "COMPLETED | FAILED | REVERSED"
        bigint amount "> 0"
        bigint fee ">= 0"
        uuid from_wallet_id FK "UK with idempotency_key"
        uuid to_wallet_id FK
        uuid initiated_by FK
        string idempotency_key
        string note
        timestamptz created_at
    }
    ledger_entries {
        uuid id PK
        bigint seq UK "true per-wallet order"
        uuid transaction_id FK
        uuid wallet_id FK
        bigint amount "signed, never 0"
        bigint balance_after
        timestamptz created_at
    }
    fee_rules {
        TransactionType type PK
        bigint flat_fee
        int percent_bp
        int agent_commission_bp
        bigint min_amount_for_fee
        timestamptz updated_at
    }
    limit_rules {
        TransactionType type PK
        bigint min_amount
        bigint max_per_txn "NULL = no limit"
        int max_count_day
        int max_count_month
        bigint max_amount_day
        bigint max_amount_month
        timestamptz updated_at
    }
    system_settings {
        string key PK
        string value
        timestamptz updated_at
    }

    users ||--o{ user_documents : uploads
    users ||--o{ kyc_submissions : submits
    users |o--o{ kyc_submissions : reviews
    user_documents ||--o{ kyc_submissions : "nid_front"
    user_documents ||--o{ kyc_submissions : "nid_back"
    user_documents ||--o{ kyc_submissions : "selfie"
    users ||--o{ refresh_tokens : "signs in with"
    users |o--o{ audit_logs : "acts in"
    users |o--o| wallets : owns
    wallets ||--o{ transactions : "sends (from)"
    wallets ||--o{ transactions : "receives (to)"
    users ||--o{ transactions : initiates
    transactions ||--|{ ledger_entries : "has 2 or more"
    wallets ||--o{ ledger_entries : "is moved by"
```

`otp_codes`, `fee_rules`, `limit_rules` and `system_settings` have no foreign keys: OTPs are
keyed by phone before an account exists, and the rule tables are keyed by transaction type.
