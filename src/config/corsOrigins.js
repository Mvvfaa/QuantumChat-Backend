// Known Quantum product frontends, merged with CLIENT_URL / CORS_ORIGINS.
// Used by app.js as the browser CORS gate.
export const allowedOrigins = [
  ...new Set([
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    // Digital Logic Studio (Boolforge) — QuantumChat dock embeds the API
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'https://circuits.quantumlogicslimited.com',
    'https://www.circuits.quantumlogicslimited.com',
    'https://digital-logics-studio.vercel.app',
    'https://digital-logics-studio-seven.vercel.app',
    'https://chat.quantumlogicslimited.com',
    'https://ai.quantumlogicslimited.com',
    'https://quantum-chat.vercel.app',
    'https://quantum-chat-frontend.vercel.app',
    'https://quantum-chat-frontend-mu.vercel.app',
    'https://quantum-ai-frontend.vercel.app',
    ...String(process.env.CLIENT_URL || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    ...String(process.env.CORS_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]),
];
