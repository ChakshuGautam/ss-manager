#!/usr/bin/env node

import { program } from 'commander';
import * as Minio from 'minio';
import dotenv from 'dotenv';
import clipboardy from 'clipboardy';
import { execSync } from 'child_process';
import { homedir } from 'os';
import path from 'path';

// Load config from ~/.ss-manager/.env
dotenv.config({ path: path.join(homedir(), '.ss-manager', '.env') });

const {
  MINIO_ENDPOINT,
  MINIO_PORT,
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_USE_SSL,
  MINIO_BUCKET,
  PUBLIC_URL_BASE,
} = process.env;

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT || 'localhost',
  port: parseInt(MINIO_PORT || '9000', 10),
  useSSL: MINIO_USE_SSL === 'true',
  accessKey: MINIO_ACCESS_KEY || '',
  secretKey: MINIO_SECRET_KEY || '',
});

const bucket = MINIO_BUCKET || 'screenshots';
const urlBase = (PUBLIC_URL_BASE || '').replace(/\/$/, '');

function buildUrl(name) {
  return `${urlBase}/${encodeURIComponent(name)}`;
}

async function listObjects(limit = 20, search = null) {
  return new Promise((resolve, reject) => {
    const objects = [];
    const stream = minioClient.listObjectsV2(bucket, '', true);

    stream.on('data', (obj) => {
      if (obj.name) {
        if (search && !obj.name.toLowerCase().includes(search.toLowerCase())) {
          return;
        }
        objects.push({
          name: obj.name,
          size: obj.size,
          lastModified: obj.lastModified,
          url: buildUrl(obj.name),
        });
      }
    });

    stream.on('error', reject);
    stream.on('end', () => {
      // Sort by lastModified descending (most recent first)
      objects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      resolve(objects.slice(0, limit));
    });
  });
}

function findByPartialName(objects, name) {
  const lower = name.toLowerCase();
  return objects.find((obj) => obj.name.toLowerCase().includes(lower));
}

program
  .name('ss')
  .description('Screenshot manager CLI')
  .version('1.0.0');

program
  .command('list')
  .description('List recent screenshots (last 20)')
  .action(async () => {
    try {
      const objects = await listObjects(20);
      if (objects.length === 0) {
        console.log('No screenshots found.');
        return;
      }
      console.log(`\nRecent screenshots (${objects.length}):\n`);
      for (const obj of objects) {
        const date = new Date(obj.lastModified).toLocaleString();
        console.log(`  ${obj.name}`);
        console.log(`    ${obj.url}`);
        console.log(`    ${date}\n`);
      }
    } catch (err) {
      console.error('Error listing screenshots:', err.message);
      process.exit(1);
    }
  });

program
  .command('url <name>')
  .description('Print the public URL for a screenshot (partial name match OK)')
  .action(async (name) => {
    try {
      const objects = await listObjects(1000);
      const match = findByPartialName(objects, name);
      if (!match) {
        console.error(`No screenshot matching "${name}" found.`);
        process.exit(1);
      }
      console.log(match.url);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('copy <name>')
  .description('Copy screenshot URL to clipboard')
  .action(async (name) => {
    try {
      const objects = await listObjects(1000);
      const match = findByPartialName(objects, name);
      if (!match) {
        console.error(`No screenshot matching "${name}" found.`);
        process.exit(1);
      }
      await clipboardy.write(match.url);
      console.log(`Copied to clipboard: ${match.url}`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('latest')
  .description('Print URL of most recent screenshot')
  .action(async () => {
    try {
      const objects = await listObjects(1);
      if (objects.length === 0) {
        console.error('No screenshots found.');
        process.exit(1);
      }
      console.log(objects[0].url);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('open <name>')
  .description('Open screenshot URL in browser')
  .action(async (name) => {
    try {
      const objects = await listObjects(1000);
      const match = findByPartialName(objects, name);
      if (!match) {
        console.error(`No screenshot matching "${name}" found.`);
        process.exit(1);
      }
      console.log(`Opening: ${match.url}`);
      execSync(`open "${match.url}"`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse();
