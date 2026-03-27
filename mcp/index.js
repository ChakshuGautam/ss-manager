#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as Minio from 'minio';
import dotenv from 'dotenv';
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
      objects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      resolve(objects.slice(0, limit));
    });
  });
}

// Create the MCP server
const server = new McpServer({
  name: 'ss-manager',
  version: '1.0.0',
});

// Tool: list_screenshots
server.tool(
  'list_screenshots',
  'List recent screenshots from the screenshot manager. Returns name, URL, size, and last modified date.',
  {
    limit: z.number().default(20).describe('Maximum number of screenshots to return'),
    search: z.string().optional().describe('Optional filename filter to search for'),
  },
  async ({ limit, search }) => {
    try {
      const objects = await listObjects(limit, search || null);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(objects, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error listing screenshots: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: get_screenshot_url
server.tool(
  'get_screenshot_url',
  'Get the public URL for a screenshot by name. Supports partial name matching.',
  {
    name: z.string().describe('Screenshot filename (partial match OK)'),
  },
  async ({ name }) => {
    try {
      const objects = await listObjects(1000);
      const lower = name.toLowerCase();
      const match = objects.find((obj) => obj.name.toLowerCase().includes(lower));

      if (!match) {
        return {
          content: [{ type: 'text', text: `No screenshot matching "${name}" found.` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ name: match.name, url: match.url }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: get_latest_screenshot
server.tool(
  'get_latest_screenshot',
  'Get the most recent screenshot. Returns name, URL, size, and last modified date.',
  {},
  async () => {
    try {
      const objects = await listObjects(1);
      if (objects.length === 0) {
        return {
          content: [{ type: 'text', text: 'No screenshots found.' }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(objects[0], null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: search_screenshots
server.tool(
  'search_screenshots',
  'Search screenshots by name pattern. Returns matching screenshots with URLs.',
  {
    query: z.string().describe('Search query to match against screenshot filenames'),
  },
  async ({ query }) => {
    try {
      const objects = await listObjects(1000, query);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(objects, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error searching screenshots: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
