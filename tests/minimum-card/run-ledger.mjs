import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const db = new PGlite();
for (const file of ['tests/minimum-card/schema-fixture.sql', 'supabase/migrations/20261109200000_minimum_existing_customer_cards.sql', 'tests/minimum-card/ledger.sql']) {
  await db.exec(await readFile(file, 'utf8'));
}
console.log('Focused ledger checks passed: binding/retry, preserved balance, event/payment replay, distinct receipts/reusable links, delayed canceled receipt, durable discount review, identity rejection, atomic failure rollback, reversal-before-success, service-only grants.');
await db.close();
