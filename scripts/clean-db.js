// Deletes all documents from the QuantumChat collections (users, messages,
// attachments) — for clearing out test data. Does NOT drop the database or
// collections themselves, so indexes stay intact.
//
// Usage:
//   node scripts/clean-db.js           # dry run — shows counts, deletes nothing
//   node scripts/clean-db.js --yes     # actually deletes
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { UPLOAD_DIR } from '../src/middleware/upload.js';
import User from '../src/models/User.js';
import Message from '../src/models/Message.js';
import Attachment from '../src/models/Attachment.js';

const confirmed = process.argv.includes('--yes');

async function main() {
  await connectDB();
  console.log(`Connected to: ${mongoose.connection.host}/${mongoose.connection.name}\n`);

  const counts = {
    users: await User.countDocuments(),
    messages: await Message.countDocuments(),
    attachments: await Attachment.countDocuments(),
  };

  console.log('Current document counts:');
  console.log(`  users:       ${counts.users}`);
  console.log(`  messages:    ${counts.messages}`);
  console.log(`  attachments: ${counts.attachments}`);

  if (!confirmed) {
    console.log('\nDry run — nothing deleted. Re-run with --yes to actually clean these collections.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('\nDeleting...');
  const results = await Promise.all([User.deleteMany({}), Message.deleteMany({}), Attachment.deleteMany({})]);
  console.log(`  users:       deleted ${results[0].deletedCount}`);
  console.log(`  messages:    deleted ${results[1].deletedCount}`);
  console.log(`  attachments: deleted ${results[2].deletedCount}`);

  let filesDeleted = 0;
  if (fs.existsSync(UPLOAD_DIR)) {
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      fs.unlinkSync(path.join(UPLOAD_DIR, name));
      filesDeleted += 1;
    }
  }
  console.log(`  upload files: deleted ${filesDeleted} from ${UPLOAD_DIR}`);

  console.log('\nDone. Collections still exist (with their indexes) — just empty.');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
