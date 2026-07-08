import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import { createApp } from "./src/app.js";
import { connectDB } from "./src/config/db.js";
import { attachSocket } from "./src/socket/index.js";

async function main() {
  await connectDB();

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: "*" },
  });
  attachSocket(io);
  app.set("io", io);

  const port = process.env.PORT || 5000;
  server.listen(port, () =>
    console.log(`QuantumChat backend listening on port ${port}`),
  );
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
