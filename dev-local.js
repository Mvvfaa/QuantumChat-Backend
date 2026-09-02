import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'child_process';
import path from 'path';

async function main() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  console.log('Started in-memory MongoDB at:', uri);
  
  const env = { ...process.env, MONGODB_URI: uri, JWT_SECRET: 'testsecret' };
  
  const child = spawn('node', ['server.js'], {
    env,
    stdio: 'inherit',
    shell: true
  });
  
  child.on('close', async () => {
    await mongod.stop();
  });
}

main().catch(console.error);
