# hive-mos-plugin

**Hive plugin for Tether MiningOS (MOS)**

Drop this plugin into any [Tether MiningOS](https://docs.mos.tether.io) stack to:
1. Push your site/worker hashrate telemetry to the Hive orchestration layer
2. Receive agent-routed paying demand back via Hive's booking engine
3. Auto-settle BTC→USDC via [Boltz](https://boltz.exchange) when your balance hits your threshold

No hardware changes. No cloud lock-in. Pure software on top of your existing MOS install.

<div style="color:#C08D23; font-weight:bold;">Hive brand gold: #C08D23</div>

---

## 1-Line Install

```bash
curl -sL https://raw.githubusercontent.com/srotzin/hive-mos-plugin/main/docker-compose.yml \
  | HIVE_OPERATOR_DID=did:key:YOUR_DID \
    HIVE_OPERATOR_KEY=0xYOUR_KEY \
    HIVE_WALLET_ADDR=0xYOUR_WALLET \
    docker compose -f - up -d
```

That's it. The plugin starts syncing telemetry every 60 seconds and watching for payouts.

---

## How It Works

```
Your MOS install                Hive Orchestration Layer
┌──────────────────┐            ┌──────────────────────────────┐
│ Antminer         │            │ /v1/mining/orchestrate/      │
│ Whatsminer   ────┼─telemetry─▶│   sites/sync (Tier3 $0.05)  │
│ Auradine         │            │   sites (Tier1 $0.001)       │
│                  │◀─demand────│   payouts (Tier1 $0.001)     │
│ MOS SDK          │            │   withdraw (Tier3 $0.05)     │
└──────────────────┘            │                              │
                                │ /v1/mining/book              │
                                │   (existing booking engine)  │
                                └──────────────────────────────┘
                                           │
                                           ▼
                                 Boltz BTC→USDC swap
                                 Base USDC to your wallet
```

**2% routing fee** is taken at `/v1/mining/book` when a buyer books your hashrate. All settlements are real Base USDC via x402 — no mock receipts, no simulated transactions.

---

## Configuration

Set these environment variables (or add to a `.env` file):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HIVE_OPERATOR_DID` | ✅ | — | Your operator DID (e.g. `did:key:z6Mk...`) |
| `HIVE_OPERATOR_KEY` | ✅ | — | Your operator private key (hex) |
| `HIVE_WALLET_ADDR` | ✅ | — | EVM wallet for USDC payouts (`0x...`) |
| `HIVE_BASE_URL` | — | `https://hivemorph.onrender.com` | Hive base URL |
| `MOS_LOCAL_URL` | — | `http://localhost:8080` | Local MOS SDK endpoint |
| `MOS_SITE_IDS` | — | (all sites) | Comma-separated site IDs to push |
| `PAYOUT_THRESHOLD_USDC` | — | `1.0` | Min USDC before auto-withdraw is constructed |
| `SYNC_INTERVAL_MS` | — | `60000` | Telemetry push interval (ms) |

---

## Register as a MOS Operator on Hive

```bash
# Register your MOS instance (Tier 3, $0.05 USDC)
curl -X POST https://hivemorph.onrender.com/v1/mining/orchestrate/register \
  -H "Content-Type: application/json" \
  -d '{
    "operator_did": "did:key:YOUR_DID",
    "mos_endpoint": "https://your-mos.example.com",
    "sites": ["site-a", "site-b"],
    "wallet_addr": "0xYOUR_WALLET"
  }'
```

Registration is idempotent — safe to call multiple times with the same `operator_did`.

---

## API Reference

All endpoints are on [hivemorph.onrender.com](https://hivemorph.onrender.com):

| Method | Endpoint | Tier | Price | Description |
|--------|----------|------|-------|-------------|
| GET | `/v1/mining/orchestrate/health` | 0 | Free | Capabilities & version |
| POST | `/v1/mining/orchestrate/register` | 3 | $0.05 | Register MOS instance |
| POST | `/v1/mining/orchestrate/sites/sync` | 3 | $0.05 | Push telemetry batch |
| GET | `/v1/mining/orchestrate/sites` | 1 | $0.001 | List sites + telemetry |
| GET | `/v1/mining/orchestrate/payouts` | 1 | $0.001 | Pending USDC balance |
| POST | `/v1/mining/orchestrate/payouts/withdraw` | 3 | $0.05 | Construct BTC→USDC payout |

Pricing is enforced via [x402](https://x402.org). Earn surfaces catalog: [/v1/earn/catalog](https://hivemorph.onrender.com/v1/earn/catalog).

---

## MCP Tools (hive-mcp-mining)

Use the [hive-mcp-mining](https://github.com/srotzin/hive-mcp-mining) shim to call these endpoints from any MCP-compatible agent:

```json
{
  "tool": "mos.query_hashrate",
  "arguments": { "operator_did": "did:key:YOUR_DID" }
}
```

Available MCP tools (v1.1.0+): `mos.query_hashrate`, `mos.query_payouts`, `mos.book_hashrate`

---

## Earn Discovery

```bash
curl https://hivemorph.onrender.com/v1/earn/catalog | jq '.surfaces[] | select(.category == "mining_orchestrate")'
```

---

## License

Apache-2.0 — matches Tether MiningOS license.

See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "hive-mos-plugin",
  "version": "0.1.0",
  "description": "Hive plugin for Tether MiningOS — push site telemetry, receive paying demand, auto-settle BTC→USDC.",
  "url": "https://github.com/srotzin/hive-mos-plugin",
  "provider": {
    "@type": "Organization",
    "name": "Hive",
    "url": "https://hivemorph.onrender.com"
  },
  "license": "https://www.apache.org/licenses/LICENSE-2.0",
  "offers": {
    "@type": "Offer",
    "price": "0.05",
    "priceCurrency": "USDC"
  },
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "routing_fee_rate", "value": "0.02" },
    { "@type": "PropertyValue", "name": "settle_chain", "value": "base" },
    { "@type": "PropertyValue", "name": "settle_asset", "value": "USDC" },
    { "@type": "PropertyValue", "name": "capability", "value": "mining-orchestrate" },
    { "@type": "PropertyValue", "name": "brand_color", "value": "#C08D23" }
  ]
}
</script>
