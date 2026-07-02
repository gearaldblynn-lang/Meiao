# Chatwoot local deployment

Chatwoot is deployed locally as the customer-service backend for the Meiao AI customer service module.

## URLs

- Meiao frontend: http://localhost:3000
- Chatwoot backend/admin: http://localhost:3001

## Commands

```bash
cd deploy/chatwoot
docker compose run --rm rails bundle exec rails db:chatwoot_prepare
docker compose up -d
```

Stop services:

```bash
cd deploy/chatwoot
docker compose down
```

Reset all local Chatwoot data:

```bash
cd deploy/chatwoot
docker compose down -v
```

## Meiao connection fields

Use these values in the Meiao AI客服 page after creating a Chatwoot account and inbox:

- 服务地址: `http://localhost:3001`
- Account ID: usually `1` for the first local account
- Inbox ID: copy from the Chatwoot inbox URL or API response
- API Token: Chatwoot profile access token
- Website Token: only needed for website-widget/contact APIs, not for admin conversation APIs

## Local AI webhook

The local Chatwoot deployment enables `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` so account webhooks can call the Meiao backend running on the host machine.

Use one of these webhook URLs in Chatwoot depending on the Docker runtime:

- Docker Desktop: `http://host.docker.internal:3100/api/chatwoot/ai-webhook`
- Colima/Lima: `http://host.lima.internal:3100/api/chatwoot/ai-webhook`

Subscribe to `message_created`. The Meiao backend ignores outgoing messages to avoid reply loops.
