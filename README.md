# Quantum Chat

Production-ready, multi-tenant embeddable messaging platform. One central backend serves multiple company websites via an embeddable React widget and JavaScript SDK.

## Architecture

```
quantum-chat/
├── backend/           # API server (Express + MongoDB + Socket.IO)
├── frontend/
│   ├── admin/         # Admin dashboard (React)
│   ├── widget/        # Embeddable chat widget (React)
│   └── sdk/           # JavaScript SDK (script tag)
├── shared/            # Shared TypeScript types
├── package.json       # Root monorepo
└── README.md
```

### Multi-Tenant Model

- Each **Website** has a unique `tenantId`, `apiKey`, and `domain`
- All data (users, conversations, messages) is scoped by `websiteId`
- Dynamic CORS validates requesting origins against registered domains
- Widget authenticates via API key + JWT (or host app token)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS, Vite |
| Backend | Node.js, Express, MVC architecture |
| Database | MongoDB, Mongoose |
| Real-time | Socket.IO |
| Auth | JWT, API keys, RBAC |

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB 6+

### Installation

```bash
# Clone and install
cd QuantumChat
npm install

# Configure backend
cp backend/.env.example backend/.env

# Seed demo data
npm run seed

# Start backend + frontend together
npm run dev
```

| Service | URL |
|---------|-----|
| API Server | http://localhost:4000 |
| Widget Dev | http://localhost:5173 |
| Admin Dashboard | http://localhost:5174 |

### Default Admin Credentials

- Email: `admin@quantumchat.io`
- Password: `Admin123!` (from `.env`)

## MongoDB Collections

| Collection | Purpose |
|-----------|---------|
| `websites` | Tenant config, branding, API keys |
| `users` | Per-website users with roles |
| `conversations` | 1:1 conversations with unread counts |
| `messages` | Messages with reactions, replies, status |
| `attachments` | File upload metadata |
| `notifications` | In-app notifications |
| `sessions` | Active JWT sessions |

## REST API Endpoints

### Public (API Key)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/websites/config` | Widget branding config |
| POST | `/api/v1/auth/widget` | Widget user authentication |
| POST | `/api/v1/auth/login` | Email/password login |
| POST | `/api/v1/auth/admin/login` | Admin login |

### Authenticated

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/auth/me` | Current user |
| GET | `/api/v1/conversations` | List conversations |
| POST | `/api/v1/conversations` | Start conversation |
| GET | `/api/v1/conversations/search` | Search conversations |
| GET | `/api/v1/conversations/unread` | Total unread count |
| GET | `/api/v1/conversations/:id/messages` | Paginated messages |
| POST | `/api/v1/messages` | Send message |
| PATCH | `/api/v1/messages/:id` | Edit message |
| DELETE | `/api/v1/messages/:id` | Delete message |
| POST | `/api/v1/messages/:id/react` | React to message |
| POST | `/api/v1/conversations/:id/read` | Mark as read |
| GET | `/api/v1/users/search` | Search users |
| POST | `/api/v1/attachments` | Upload file |
| GET | `/api/v1/notifications` | List notifications |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/v1/admin/websites` | Manage websites |
| PATCH | `/api/v1/admin/websites/:id` | Update branding/settings |
| POST | `/api/v1/admin/websites/:id/verify` | Verify domain |
| GET | `/api/v1/admin/websites/:id/analytics` | Analytics |
| GET | `/api/v1/admin/users` | List users |
| PATCH | `/api/v1/admin/users/:id/block` | Block/unblock user |
| GET | `/api/v1/admin/messages` | Moderate messages |

## Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `conversation:join` | Client → Server | Join conversation room |
| `message:send` | Client → Server | Send real-time message |
| `message:new` | Server → Client | New message received |
| `message:edit` / `message:edited` | Both | Edit message |
| `message:delete` / `message:deleted` | Both | Delete message |
| `message:react` / `message:reacted` | Both | Emoji reactions |
| `message:read` / `message:status` | Both | Read receipts |
| `typing:start` / `typing:stop` / `typing:update` | Both | Typing indicators |
| `presence:update` / `presence:bulk` | Server → Client | Online/offline |
| `unread:count` | Server → Client | Unread badge update |
| `conversation:updated` | Server → Client | Conversation list refresh |
| `notification:new` | Server → Client | New notification |

## Widget Embedding

See [INSTALLATION.md](./INSTALLATION.md) for full integration guide.

### npm Package

```tsx
import { init } from '@quantum-chat/widget';

init({
  websiteId: 'YOUR_WEBSITE_ID',
  apiKey: 'YOUR_API_KEY',
  apiUrl: 'https://api.yourdomain.com',
  user: {
    externalId: 'user-123',
    email: 'user@company.com',
    displayName: 'Jane Doe',
  },
  theme: {
    primaryColor: '#0A66C2',
    welcomeMessage: 'Chat with us!',
    position: 'bottom-right',
  },
});
```

### Script Tag

```html
<script src="https://cdn.yourdomain.com/quantum-chat-sdk.umd.js"></script>
<script>
  createQuantumChat({
    websiteId: 'YOUR_WEBSITE_ID',
    apiKey: 'YOUR_API_KEY',
    apiUrl: 'https://api.yourdomain.com',
    user: { email: 'user@company.com', displayName: 'Jane Doe' },
  });
</script>
```

## Security

- **JWT Authentication** with session tracking
- **API Keys** per website tenant
- **Dynamic CORS** based on registered domains
- **Rate Limiting** on API and auth endpoints
- **Helmet** security headers
- **RBAC** — user, moderator, admin, super_admin
- **Input Validation** via express-validator
- **File Upload** type and size restrictions

## Production Build

```bash
npm run build
npm start
```

## License

MIT
