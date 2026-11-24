// The full system seed (wallets, fee and limit rules, settings) for tests that need real rules.
// Ledger-only tests keep using createSystemWallets() from ./wallets.
export { seedSystem } from '../../src/db/seed';
