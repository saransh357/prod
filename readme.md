# CryptoAPI — Encryption as a Service

A production-ready API provider that wraps your `pendulum_key_gen.py` (SARA)
encryption server with customer management, API key issuance, usage tracking,
and a customer portal.

## Architecture

```
Customer → CryptoAPI (port 8000) → SARA / pendulum_key_gen (port 5000)
                ↕
           SQLite DB (cryptoapi.db)
```

## Setup

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Start your SARA server first
```bash
python pendulum_key_gen.py
# Note the Bearer token printed at startup
```

### 3. Configure environment
```bash
export SARA_URL="http://localhost:5000"
export SARA_TOKEN="your-sara-bearer-token"
export ADMIN_SECRET="choose-a-strong-admin-password"
```

### 4. Start CryptoAPI
```bash
python app.py
# Starts on http://localhost:8000
```

### 5. Open the customer portal
Visit: http://localhost:8000/portal

---

## API Reference

### Public (no auth)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/register` | Create account, returns API key |

### Customer (Bearer token required)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/encrypt` | AES-256-GCM encrypt |
| POST | `/v1/decrypt` | AES-256-GCM decrypt |
| GET | `/v1/usage` | Usage stats + 30-day history |
| GET | `/v1/keys` | List your API keys |
| POST | `/v1/keys` | Create additional key |
| POST | `/v1/keys/revoke` | Revoke a key by prefix |
| GET | `/v1/status` | Encryption server health |

### Admin (X-Admin-Secret header)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/customers` | List all customers |
| POST | `/admin/customers/<id>/tier` | Set tier (free/pro) |
| GET | `/admin/stats` | Platform-wide stats |

---

## Tier Quotas

| Tier | Requests/day |
|------|-------------|
| Free | 100 |
| Pro | 10,000 |

Upgrade a customer to Pro:
```bash
curl -X POST http://localhost:8000/admin/customers/1/tier \
  -H "X-Admin-Secret: your-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"tier":"pro"}'
```

---

## Key design decisions

- **Customer API keys** (`ck_live_…`) are separate from the **encryption key**
  inside SARA. Customer keys identify who is making a request; the SARA key
  is what actually encrypts data.
- Keys are stored as **SHA-256 hashes** — we never store the raw key.
- **Daily counts** use an upsert into `daily_counts` — fast, atomic, no race conditions.
- The portal is served by Flask at `/portal` — no separate frontend server needed.

---

## Production checklist

- [ ] Replace SQLite with Postgres (`psycopg2`)
- [ ] Put Nginx in front of Flask (gunicorn workers)
- [ ] Add HTTPS / TLS termination
- [ ] Store `ADMIN_SECRET` and `SARA_TOKEN` in a secrets manager
- [ ] Add Stripe webhooks to `/admin/customers/<id>/tier` for billing
- [ ] Rate-limit `/v1/register` to prevent abuse
- [ ] Set up log aggregation for `usage_log`
