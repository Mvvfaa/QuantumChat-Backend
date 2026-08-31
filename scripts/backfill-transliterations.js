/**
 * Backfill Transliterated Names Script
 *
 * Iterates over all existing users in MongoDB and populates the `transliteratedNames`
 * field ({ ur, ar, fa, hi, zh, ru }) for pre-existing accounts that were created
 * before the transliteration feature was deployed.
 *
 * Usage:
 *   node scripts/backfill-transliterations.js          # Dry run (shows changes, does not save)
 *   node scripts/backfill-transliterations.js --yes    # Actually save updates to MongoDB
 *   node scripts/backfill-transliterations.js --yes --force # Regenerate for all accounts
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import {
  generateTransliteratedNames,
  SUPPORTED_NON_LATIN_LANGS,
} from '../src/services/transliterationService.js';

const confirmed = process.argv.includes('--yes');
const force = process.argv.includes('--force');

async function main() {
  await connectDB();
  console.log(`Connected to database: ${mongoose.connection.host}/${mongoose.connection.name}\n`);
  console.log(`Mode: ${confirmed ? 'LIVE (will persist to DB)' : 'DRY RUN (pass --yes to apply)'}`);
  if (force) console.log('Option --force enabled: will recompute all supported language scripts\n');

  const users = await User.find({});
  console.log(`Found ${users.length} total user account(s) in database.\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const user of users) {
    const rawName = user.displayName?.trim() || user.username?.trim();
    if (!rawName) {
      console.log(`- Skipping user [${user._id}] with no username/displayName`);
      skippedCount++;
      continue;
    }

    const currentNames = user.transliteratedNames?.toObject
      ? user.transliteratedNames.toObject()
      : user.transliteratedNames || {};

    const missingKeys = SUPPORTED_NON_LATIN_LANGS.filter(
      (lang) => !currentNames[lang] || typeof currentNames[lang] !== 'string' || !currentNames[lang].trim()
    );

    if (!force && missingKeys.length === 0) {
      console.log(`✓ User "${user.username}" already has all transliterated names. Skipping.`);
      skippedCount++;
      continue;
    }

    try {
      const generated = await generateTransliteratedNames(rawName);
      const nextNames = { ...currentNames };

      for (const lang of SUPPORTED_NON_LATIN_LANGS) {
        if (force || !nextNames[lang]) {
          nextNames[lang] = generated[lang] || '';
        }
      }

      console.log(`• User "${user.username}" (${user.displayName ? `"${user.displayName}"` : 'no display name'}):`);
      console.log(`    Urdu (ur):     ${nextNames.ur || '(none)'}`);
      console.log(`    Arabic (ar):   ${nextNames.ar || '(none)'}`);
      console.log(`    Persian (fa):  ${nextNames.fa || '(none)'}`);
      console.log(`    Hindi (hi):    ${nextNames.hi || '(none)'}`);
      console.log(`    Chinese (zh):  ${nextNames.zh || '(none)'}`);
      console.log(`    Russian (ru):  ${nextNames.ru || '(none)'}`);

      if (confirmed) {
        user.transliteratedNames = nextNames;
        user.markModified('transliteratedNames');
        await user.save();
        console.log(`    => SAVED successfully.\n`);
      } else {
        console.log(`    => [DRY RUN: Pass --yes to save]\n`);
      }

      updatedCount++;
    } catch (err) {
      console.error(`✕ Failed to process user "${user.username}":`, err.message);
      errorCount++;
    }
  }

  console.log('--------------------------------------------------');
  console.log(`Summary:`);
  console.log(`  Users evaluated:  ${users.length}`);
  console.log(`  Users ${confirmed ? 'updated' : 'to update'}:   ${updatedCount}`);
  console.log(`  Users skipped:    ${skippedCount}`);
  console.log(`  Errors:           ${errorCount}`);
  console.log('--------------------------------------------------\n');

  if (!confirmed && updatedCount > 0) {
    console.log('To apply these changes, re-run with:');
    console.log('  node scripts/backfill-transliterations.js --yes\n');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error during backfill:', err.message);
  process.exit(1);
});
