/**
 * hive-mos-plugin/src/index.js
 *
 * Main entry point for the Hive MOS Plugin.
 *
 * What it does:
 *   1. Reads your MOS install's hashrate & site telemetry via the local MOS SDK.
 *   2. Pushes telemetry to /v1/mining/orchestrate/sites/sync on Hivemorph (signed
 *      with your operator key).
 *   3. Receives paying demand routed back via /v1/mining/book bookings.
 *   4. Auto-settles BTC→USDC via Boltz when balance >= configured threshold.
 *
 * Configuration (environment variables):
 *   HIVE_BASE_URL           Hivemorph base URL (default: https://hivemorph.onrender.com)
 *   HIVE_OPERATOR_DID       Your operator DID (e.g. did:key:z6MkhaXgB...)
 *   HIVE_OPERATOR_KEY       Your operator private key (hex or PEM)
 *   MOS_LOCAL_URL           Local MOS SDK endpoint (default: http://localhost:8080)
 *   MOS_SITE_IDS            Comma-separated list of site IDs to push
 *   HIVE_WALLET_ADDR        EVM wallet address for USDC payouts (0x...)
 *   PAYOUT_THRESHOLD_USDC   Min USDC balance before auto-withdraw (default: 1.0)
 *   SYNC_INTERVAL_MS        Telemetry push interval in ms (default: 60000 = 1 min)
 *
 * License: Apache-2.0
 * Brand: #C08D23
 */

import { MosAdapter } from './mos_adapter.js';
import { HiveClient } from './hive_client.js';

const HIVE_BASE_URL = process.env.HIVE_BASE_URL ?? 'https://hivemorph.onrender.com';
const OPERATOR_DID = process.env.HIVE_OPERATOR_DID ?? '';
const OPERATOR_KEY = process.env.HIVE_OPERATOR_KEY ?? '';
const MOS_LOCAL_URL = process.env.MOS_LOCAL_URL ?? 'http://localhost:8080';
const SITE_IDS = (process.env.MOS_SITE_IDS ?? '').split(',').filter(Boolean);
const WALLET_ADDR = process.env.HIVE_WALLET_ADDR ?? '';
const PAYOUT_THRESHOLD_USDC = parseFloat(process.env.PAYOUT_THRESHOLD_USDC ?? '1.0');
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS ?? '60000', 10);

// ── Validation ────────────────────────────────────────────────────────────────

function validateConfig() {
  const missing = [];
  if (!OPERATOR_DID) missing.push('HIVE_OPERATOR_DID');
  if (!OPERATOR_KEY) missing.push('HIVE_OPERATOR_KEY');
  if (!WALLET_ADDR) missing.push('HIVE_WALLET_ADDR');
  if (!/^0x[0-9a-fA-F]{40}$/.test(WALLET_ADDR) && WALLET_ADDR) {
    throw new Error(`HIVE_WALLET_ADDR must be a 0x EVM address, got: ${WALLET_ADDR}`);
  }
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function runSyncCycle(mos, hive) {
  const sites = SITE_IDS.length > 0 ? SITE_IDS : await mos.listSites();
  for (const siteId of sites) {
    try {
      const telemetry = await mos.getSiteTelemetry(siteId);
      const batchTs = Math.floor(Date.now() / 1000);
      const result = await hive.syncSite({ siteId, batchTs, telemetry });
      if (result.created) {
        console.log(`[hive-mos-plugin] synced site=${siteId} batch_ts=${batchTs}`);
      } else if (result.idempotent) {
        console.log(`[hive-mos-plugin] idempotent replay site=${siteId} batch_ts=${batchTs}`);
      }
    } catch (err) {
      console.error(`[hive-mos-plugin] sync error site=${siteId}: ${err.message}`);
    }
  }
}

async function checkPayouts(hive) {
  try {
    const balance = await hive.getPayoutBalance();
    const pendingUsdc = balance.pending_usdc ?? 0;
    if (pendingUsdc >= PAYOUT_THRESHOLD_USDC) {
      console.log(`[hive-mos-plugin] payout threshold reached: ${pendingUsdc} USDC`);
      const result = await hive.withdraw({ amountUsdc: pendingUsdc });
      console.log(`[hive-mos-plugin] withdraw constructed: payout_id=${result.payout_id} status=${result.status}`);
    }
  } catch (err) {
    console.error(`[hive-mos-plugin] payout check error: ${err.message}`);
  }
}

async function main() {
  validateConfig();

  const mos = new MosAdapter({ localUrl: MOS_LOCAL_URL });
  const hive = new HiveClient({
    baseUrl: HIVE_BASE_URL,
    operatorDid: OPERATOR_DID,
    operatorKey: OPERATOR_KEY,
    walletAddr: WALLET_ADDR,
  });

  // Register operator on startup (idempotent)
  try {
    const reg = await hive.registerOperator({ sites: SITE_IDS });
    console.log(`[hive-mos-plugin] operator registered: ${reg.operator_did}`);
  } catch (err) {
    console.error(`[hive-mos-plugin] registration error: ${err.message}`);
    process.exit(1);
  }

  // Initial sync
  await runSyncCycle(mos, hive);
  await checkPayouts(hive);

  // Periodic sync loop
  setInterval(async () => {
    await runSyncCycle(mos, hive);
    await checkPayouts(hive);
  }, SYNC_INTERVAL_MS);

  console.log(`[hive-mos-plugin] running — sync every ${SYNC_INTERVAL_MS}ms`);
}

main().catch((err) => {
  console.error('[hive-mos-plugin] fatal:', err.message);
  process.exit(1);
});
