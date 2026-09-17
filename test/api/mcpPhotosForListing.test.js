/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const getListingById = vi.fn();
vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  queryListings: vi.fn(() => ({ totalNumber: 0, page: 1, result: [] })),
  getListingById,
}));
vi.mock('../../lib/mcp/mcpAuthentication.js', () => ({
  authenticateToolCall: vi.fn(() => ({ user: { id: 'u1', isAdmin: false } })),
  checkJobAccess: vi.fn(() => true),
}));

const { createMcpServer } = await import('../../lib/mcp/mcpAdapter.js');

async function callTool(name, args) {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  return result;
}

/** A 1x1 GIF - the smallest fixture whose magic bytes are unambiguous. */
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]);

function imageResponse(bytes = GIF_BYTES) {
  return {
    ok: true,
    headers: { get: () => 'image/gif' },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe('get_photos_for_listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns one image content block per stored photo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse()),
    );
    getListingById.mockReturnValue({
      id: 'a',
      images: ['https://cdn.example.com/0.gif', 'https://cdn.example.com/1.gif'],
    });

    const result = await callTool('get_photos_for_listing', { listingId: 'a' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.content).toHaveLength(2);
    expect(result.content.every((c) => c.type === 'image' && c.mimeType === 'image/gif')).toBe(true);
  });

  it('errors when the listing has no stored images', async () => {
    getListingById.mockReturnValue({ id: 'a', images: [] });

    const result = await callTool('get_photos_for_listing', { listingId: 'a' });

    expect(result.isError).toBe(true);
  });

  it('errors when the listing is not found or not accessible', async () => {
    getListingById.mockReturnValue(null);

    const result = await callTool('get_photos_for_listing', { listingId: 'a' });

    expect(result.isError).toBe(true);
  });

  it('skips a photo that fails to fetch and notes it, without failing the whole call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(imageResponse()).mockResolvedValueOnce({ ok: false, status: 404 }),
    );
    getListingById.mockReturnValue({
      id: 'a',
      images: ['https://cdn.example.com/0.gif', 'https://cdn.example.com/gone.gif'],
    });

    const result = await callTool('get_photos_for_listing', { listingId: 'a' });

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('image');
    expect(result.content[1].type).toBe('text');
    expect(result.content[1].text).toContain('1 of 2');
  });
});
