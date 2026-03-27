#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import * as Minio from 'minio';
import dotenv from 'dotenv';
import { createServer } from 'http';

dotenv.config();

const {
  MINIO_ENDPOINT = 'minio',
  MINIO_PORT = '9000',
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_USE_SSL = 'false',
  MINIO_BUCKET = 'screenshots',
  PUBLIC_URL_BASE = '',
  MCP_PORT = '3004',
} = process.env;

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: parseInt(MINIO_PORT, 10),
  useSSL: MINIO_USE_SSL === 'true',
  accessKey: MINIO_ACCESS_KEY || '',
  secretKey: MINIO_SECRET_KEY || '',
});

const bucket = MINIO_BUCKET;
const urlBase = PUBLIC_URL_BASE.replace(/\/$/, '');

function buildUrl(name) {
  return `${urlBase}/${encodeURIComponent(name)}`;
}

async function listObjects(limit = 20, search = null) {
  return new Promise((resolve, reject) => {
    const objects = [];
    const stream = minioClient.listObjectsV2(bucket, '', true);
    stream.on('data', (obj) => {
      if (obj.name) {
        if (search && !obj.name.toLowerCase().includes(search.toLowerCase())) return;
        objects.push({ name: obj.name, size: obj.size, lastModified: obj.lastModified, url: buildUrl(obj.name) });
      }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      objects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      resolve(objects.slice(0, limit));
    });
  });
}

function createMcpServer() {
  const server = new McpServer({ name: 'ss-manager', version: '1.0.0' });

  server.tool(
    'list_screenshots',
    'List recent screenshots. Returns name, URL, size, and last modified date.',
    { limit: z.number().default(20).describe('Max screenshots to return'), search: z.string().optional().describe('Filename filter') },
    async ({ limit, search }) => {
      try {
        const objects = await listObjects(limit, search || null);
        return { content: [{ type: 'text', text: JSON.stringify(objects, null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'get_screenshot_url',
    'Get the public URL for a screenshot by name. Supports partial name matching.',
    { name: z.string().describe('Screenshot filename (partial match OK)') },
    async ({ name }) => {
      try {
        const objects = await listObjects(1000);
        const match = objects.find((obj) => obj.name.toLowerCase().includes(name.toLowerCase()));
        if (!match) return { content: [{ type: 'text', text: `No screenshot matching "${name}" found.` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ name: match.name, url: match.url }, null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'get_latest_screenshot',
    'Get the most recent screenshot. Returns name, URL, size, and last modified date.',
    {},
    async () => {
      try {
        const objects = await listObjects(1);
        if (objects.length === 0) return { content: [{ type: 'text', text: 'No screenshots found.' }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(objects[0], null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'search_screenshots',
    'Search screenshots by name pattern. Returns matching screenshots with URLs.',
    { query: z.string().describe('Search query for screenshot filenames') },
    async ({ query }) => {
      try {
        const objects = await listObjects(1000, query);
        return { content: [{ type: 'text', text: JSON.stringify(objects, null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  return server;
}

// Stateless HTTP server — new McpServer + transport per request (same pattern as DIGIT-MCP)
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${MCP_PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (url.pathname === '/mcp') {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

httpServer.listen(parseInt(MCP_PORT, 10), '0.0.0.0', () => {
  console.log(`ss-manager MCP server listening on port ${MCP_PORT}`);
});
