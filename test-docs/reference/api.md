# API Reference

Up: [Reference](README.md) · [Architecture › Data flow](../architecture.md#data-flow)

## Authentication

All requests need a bearer token:

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/payments
```

## Endpoints

### Create a payment

`POST /v1/payments`

```json
{
  "amount": { "minor": 1250, "currency": "EUR" },
  "source": { "type": "card", "token": "tok_123" },
  "capture": false
}
```

### Capture a payment

`POST /v1/payments/{id}/capture`

### Refund a payment

`POST /v1/payments/{id}/refunds`

## Error codes

| Code | HTTP | Meaning | Retry? |
| --- | --- | --- | --- |
| `invalid_request` | 400 | A field is missing or malformed | No |
| `unauthorised` | 401 | Missing or expired token | After refreshing the token |
| `card_declined` | 402 | The processor declined the card | No |
| `rate_limited` | 429 | Too many requests | Yes, after `Retry-After` |
| `processor_unavailable` | 503 | The processor timed out | Yes, with backoff |
