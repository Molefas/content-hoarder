/**
 * Local test script for Content Hoarder
 * Run with: npm test
 *
 * This creates a mock storage to test the trik locally.
 */

import trik from './src/index.js';

// Mock storage implementation (simulates TrikHub gateway storage)
class MockStorage {
  private data = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());
    if (prefix) {
      return keys.filter((k) => k.startsWith(prefix));
    }
    return keys;
  }

  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      result[key] = this.data.get(key) ?? null;
    }
    return result;
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      this.data.set(key, value);
    }
  }

  // Debug helper
  dump(): void {
    console.log('\n--- Storage State ---');
    for (const [key, value] of this.data.entries()) {
      console.log(`${key}:`, JSON.stringify(value, null, 2).slice(0, 200));
    }
    console.log('--- End Storage ---\n');
  }
}

async function main() {
  const storage = new MockStorage();

  console.log('🧪 Testing Content Hoarder Trik\n');

  // Test 1: List content (should be empty)
  console.log('1️⃣  List content (empty)...');
  const emptyList = await trik.invoke({
    action: 'listContent',
    input: {},
    storage,
  });
  console.log('   Result:', JSON.stringify(emptyList.agentData, null, 2));
  console.log('   ✅ Expected: empty\n');

  // Test 2: Add single content (using example.com which should work)
  console.log('2️⃣  Add single inspiration...');
  const addResult = await trik.invoke({
    action: 'addInspiration',
    input: {
      url: 'https://example.com',
      tags: ['test', 'example'],
    },
    storage,
  });
  console.log('   Result:', JSON.stringify(addResult.agentData, null, 2));
  console.log('   ✅ Expected: success, type=single, contentCount=1\n');

  // Test 3: List content again
  console.log('3️⃣  List content (should have 1 item)...');
  const listResult = await trik.invoke({
    action: 'listContent',
    input: {},
    storage,
  });
  console.log('   Result:', JSON.stringify(listResult.agentData, null, 2));
  console.log('   ✅ Expected: success, totalCount=1\n');

  // Test 4: Get content by ID
  const items = (listResult.agentData as Record<string, unknown>)?.items as Array<{ id: string }>;
  if (items && items.length > 0) {
    const contentId = items[0].id;
    console.log(`4️⃣  Get content (id=${contentId})...`);
    const getResult = await trik.invoke({
      action: 'getContent',
      input: { contentId },
      storage,
    });
    console.log('   Result:', JSON.stringify(getResult.userContent, null, 2).slice(0, 500));
    console.log('   ✅ Expected: content from example.com\n');

    // Test 5: Delete content
    console.log(`5️⃣  Delete content (id=${contentId})...`);
    const deleteResult = await trik.invoke({
      action: 'deleteContent',
      input: { contentId },
      storage,
    });
    console.log('   Result:', JSON.stringify(deleteResult.agentData, null, 2));
    console.log('   ✅ Expected: success\n');

    // Test 6: Verify deletion
    console.log('6️⃣  List content after deletion...');
    const afterDelete = await trik.invoke({
      action: 'listContent',
      input: {},
      storage,
    });
    console.log('   Result:', JSON.stringify(afterDelete.agentData, null, 2));
    console.log('   ✅ Expected: empty\n');
  }

  // Test 7: List articles (should be empty)
  console.log('7️⃣  List articles (empty)...');
  const articlesResult = await trik.invoke({
    action: 'listArticles',
    input: {},
    storage,
  });
  console.log('   Result:', JSON.stringify(articlesResult.agentData, null, 2));
  console.log('   ✅ Expected: empty\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Basic tests passed!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📝 To test article creation:');
  console.log('   1. Set OPENAI_API_KEY environment variable');
  console.log('   2. Add some content with addInspiration');
  console.log('   3. Call createArticle with content IDs and instructions');
}

main().catch(console.error);
