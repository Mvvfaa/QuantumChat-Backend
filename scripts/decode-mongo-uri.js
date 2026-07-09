// Shows the MongoDB credentials the backend will use (from backend/.env)
// Usage: node scripts/decode-mongo-uri.js
import 'dotenv/config';
import { buildMongoUri } from '../src/config/db.js';

let uri;
try {
  uri = buildMongoUri();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// mongodb+srv:// URIs are not valid for new URL() in Node, so swap the scheme
const parsed = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'https://'));

const username = decodeURIComponent(parsed.username);
const password = decodeURIComponent(parsed.password);

console.log('Cluster host :', parsed.hostname);
console.log('Database     :', parsed.pathname.replace(/^\//, '') || '(default)');
console.log('Username     :', username);
console.log('Password     :', password);

if (username.includes('@')) {
  console.log('\nThe username looks like an email address:', username);
} else {
  console.log(
    '\nNote: the decoded username is not an email. A MongoDB connection string only\n' +
    'contains a database user + password — the Atlas account email that owns the\n' +
    'cluster is not stored in the string. To find it, log in at cloud.mongodb.com\n' +
    'and check Organization > Access Manager.'
  );
}
