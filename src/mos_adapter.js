/**
 * hive-mos-plugin/src/mos_adapter.js
 *
 * MOS SDK adapter — wraps the local Tether MiningOS REST/P2P interface
 * to expose site telemetry in a Hive-compatible format.
 *
 * MOS docs: https://docs.mos.tether.io
 *
 * The MOS SDK provides:
 *   - Worker management (Antminer, Whatsminer, Auradine, etc.)
 *   - Site/container metrics via Holepunch P2P
 *   - Hardware-agnostic, Apache 2.0, runs on Win/macOS/Linux
 *
 * This adapter treats MOS as the local hashrate source and Hive as the
 * demand-routing + settlement layer on top.
 *
 * License: Apache-2.0
 * Brand: #C08D23
 */

import fetch from 'node-fetch';

export class MosAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.localUrl  Local MOS SDK base URL (default: http://localhost:8080)
   */
  constructor({ localUrl = 'http://localhost:8080' } = {}) {
    this.localUrl = localUrl.replace(/\/$/, '');
  }

  // ── MOS SDK stubs ──────────────────────────────────────────────────────────
  //
  // These methods wrap the MOS local API. Production implementations should
  // replace the fetch calls with the official MOS SDK once deployed against a
  // live MOS install (https://docs.mos.tether.io).

  /**
   * List all site IDs registered in the local MOS instance.
   * @returns {Promise<string[]>}
   */
  async listSites() {
    try {
      const res = await fetch(`${this.localUrl}/api/sites`);
      if (!res.ok) return [];
      const data = await res.json();
      // MOS API returns { sites: [{ id, name, ... }] } or similar
      return (data.sites ?? data).map((s) => s.id ?? s.site_id ?? String(s));
    } catch {
      // MOS not reachable locally — return empty list
      return [];
    }
  }

  /**
   * Get telemetry for a specific site from the local MOS instance.
   * Returns hashrate, worker count, temperature, uptime, etc.
   *
   * @param {string} siteId
   * @returns {Promise<object>} Telemetry payload
   */
  async getSiteTelemetry(siteId) {
    try {
      const res = await fetch(`${this.localUrl}/api/sites/${encodeURIComponent(siteId)}/telemetry`);
      if (!res.ok) {
        return {
          site_id: siteId,
          error: `mos_api_error:${res.status}`,
          ts: Math.floor(Date.now() / 1000),
        };
      }
      const data = await res.json();
      return {
        site_id: siteId,
        hashrate_th_s: data.hashrate_th_s ?? data.hashrate ?? 0,
        workers: data.workers ?? data.worker_count ?? 0,
        temperature_c: data.temperature_c ?? data.avg_temp ?? null,
        uptime_seconds: data.uptime_seconds ?? null,
        power_watts: data.power_watts ?? null,
        efficiency_j_th: data.efficiency_j_th ?? null,
        raw: data,
        ts: Math.floor(Date.now() / 1000),
      };
    } catch (err) {
      return {
        site_id: siteId,
        error: `mos_unreachable: ${err.message}`,
        ts: Math.floor(Date.now() / 1000),
      };
    }
  }

  /**
   * Get aggregate fleet stats across all sites.
   * @returns {Promise<object>}
   */
  async getFleetStats() {
    const sites = await this.listSites();
    const telemetries = await Promise.all(sites.map((id) => this.getSiteTelemetry(id)));
    const totalHashrate = telemetries.reduce((sum, t) => sum + (t.hashrate_th_s ?? 0), 0);
    const totalWorkers = telemetries.reduce((sum, t) => sum + (t.workers ?? 0), 0);
    return {
      site_count: sites.length,
      total_hashrate_th_s: totalHashrate,
      total_workers: totalWorkers,
      sites: telemetries,
      ts: Math.floor(Date.now() / 1000),
    };
  }
}
