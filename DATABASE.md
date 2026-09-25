# Adatbázisdiagram (fő entitások)

```mermaid
erDiagram
  profiles ||--|| credit_accounts : "1-1 (trigger)"
  profiles ||--|| user_settings : "1-1"
  profiles ||--o{ characters : "tulajdonos"
  characters ||--o{ character_versions : "verziók"
  characters ||--o{ character_reference_images : "referenciák"
  character_reference_images }o--|| assets : "asset"
  profiles ||--o{ generation_jobs : "owner"
  characters ||--o{ generation_jobs : "opc."
  generation_jobs ||--o{ generation_job_events : "események"
  generation_jobs ||--o{ credit_holds : "hold"
  credit_holds ||--o{ credit_transactions : "tranzakció"
  profiles ||--o{ credit_transactions : "mozgások"
  profiles ||--o{ assets : "owner"
  assets ||--o{ gallery_items : "megjelenés"
  generation_jobs ||--o{ gallery_items : "forrás"
  profiles ||--o{ albums : "owner"
  albums ||--o{ gallery_items : "album"
```

- **Állapotgépek**: `generation_jobs` (draft→awaiting_credit→queued→submitted→processing→finalizing→completed
  /retrying/failed→refunded/cancelled; SQL-trigger: `job_transition_rules`), `characters`
  (`character_status_rules`). **Lock**: `finalize_claim` (lease 10 perc), atomi `claim_job`/`claim_next_job`.
- **Kreditek**: `credit_accounts.balance >= 0` (CHECK), `credit_holds` (open→charged/released/refunded),
  minden mozgás `idempotency_key`-jel (unique).
- **Provider-folyamat**: `provider`, `provider_job_id`, `provider_meta` (endpoint/status/response URL, weights).
