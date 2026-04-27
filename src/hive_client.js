/**
 * hive-mos-plugin/src/hive_client.js
 *
 * Signed HTTP client for the Hive MOS Orchestration layer.
 *
 * All requests to /v1/mining/orchestrate/* are authenticated with the
 * operator's key using a simple HMAC-SHA256 signature over the request body.
 * x402 payment proofs are injected via the X-Payment header when required.
 *
 * RAILS_RULES compliance (hivemorph RAILS_RULES.md):
 *   - Rule 1: No mock receipts, no simulated tx hashes.
 *   - Rule 9: Withdraw is constructed-only by default.
 *
 * License: Apache-2.0
 * Brand: #C08D23
 */

import { createHmac } from 'node:crypto';
import fetch from 'node-fetch';

export class HiveClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl     Hivemorph base URL
   * @param {string} opts.operatorDid Operator DID
   * @param {string} opts.operatorKey Operator private key (hex)
   * @param {string} opts.walletAddr  EVM wallet address for payouts
   */
  constructor({ baseUrl, operatorDid, operatorKey, walletAddr }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.operatorDid = operatorDid;
    this.operatorKey = operatorKey;
    this.walletAddr = walletAddr;
  }

  // ── Signing ────────────────────────────────────────────────────────────────

  /**
   * Sign a request body with the operator key via HMAC-SHA256.
   * Returns the hex signature for the X-Hive-Sig header.
   */
  _sign(body) {
    return createHmac('sha256', this.operatorKey)
      .update(typeof body === 'string' ? body : JSON.stringify(body))
      .digest('hex');
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────

  async _post(path, body) {
    const bodyStr = JSON.stringify(body);
    const sig = this._sign(bodyStr);
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hive-Operator-DID': this.operatorDid,
        'X-Hive-Sig': sig,
      },
      body: bodyStr,
    });
    const data = await res.json();
    if (!res.ok) {
      const detail = data?.detail ?? data;
      throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(detail)}`);
    }
    return data;
  }

  async _get(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${path}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, {
      headers: {
        'X-Hive-Operator-DID': this.operatorDid,
        'X-Hive-Sig': this._sign(path),
      },
    });
    const data = await res.json();
    if (!res.ok) {
      const detail = data?.detail ?? data;
      throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(detail)}`);
    }
    return data;
  }

  // ── Orchestrate API ────────────────────────────────────────────────────────

  /**
   * Register this operator with Hive. Idempotent on operator_did.
   * Corresponds to POST /v1/mining/orchestrate/register (Tier 3 $0.05)
   */
  async registerOperator({ mosEndpoint, sites = [] } = {}) {
    return this._post('/v1/mining/orchestrate/register', {
      operator_did: this.operatorDid,
      mos_endpoint: mosEndpoint ?? `http://localhost:8080`,
      sites,
      wallet_addr: this.walletAddr,
    });
  }

  /**
   * Push site telemetry batch to Hive. Idempotent on (operator_did, site_id, batch_ts).
   * Corresponds to POST /v1/mining/orchestrate/sites/sync (Tier 3 $0.05)
   *
   * @param {object} opts
   * @param {string} opts.siteId    Site identifier
   * @param {number} opts.batchTs  Unix timestamp for this batch (seconds)
   * @param {object} opts.telemetry Telemetry data from MOS SDK
   */
  async syncSite({ siteId, batchTs, telemetry }) {
    return this._post('/v1/mining/orchestrate/sites/sync', {
      operator_did: this.operatorDid,
      site_id: siteId,
      batch_ts: batchTs,
      telemetry,
    });
  }

  /**
   * List operator's registered sites and latest telemetry.
   * Corresponds to GET /v1/mining/orchestrate/sites (Tier 1 $0.001)
   */
  async listSites() {
    return this._get('/v1/mining/orchestrate/sites', {
      operator_did: this.operatorDid,
    });
  }

  /**
   * Get pending USDC payout balance from the earn rails ledger.
   * Corresponds to GET /v1/mining/orchestrate/payouts (Tier 1 $0.001)
   */
  async getPayoutBalance() {
    return this._get('/v1/mining/orchestrate/payouts', {
      operator_did: this.operatorDid,
    });
  }

  /**
   * Construct (not dispatch) a BTC→USDC payout via Boltz.
   * Constructed-only by default (EARN_SWEEP_AUTODISPATCH=false, Rule 9).
   * Corresponds to POST /v1/mining/orchestrate/payouts/withdraw (Tier 3 $0.05)
   *
   * @param {object} opts
   * @param {number} opts.amountUsdc Amount in USDC to withdraw
   */
  async withdraw({ amountUsdc }) {
    return this._post('/v1/mining/orchestrate/payouts/withdraw', {
      operator_did: this.operatorDid,
      amount_usdc: amountUsdc,
    });
  }

  /**
   * Check capabilities of the MOS orchestration layer.
   * Corresponds to GET /v1/mining/orchestrate/health (Tier 0 free)
   */
  async health() {
    return this._get('/v1/mining/orchestrate/health');
  }
}
