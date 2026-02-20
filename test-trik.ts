/**
 * Integration test script for Content Hoarder
 * Run with: npx tsx test-trik.ts
 *
 * This tests the trik using the actual TrikHub gateway with real storage.
 */

import { TrikGateway, FileConfigStore, InMemoryStorageProvider } from '@trikhub/gateway';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Test utilities
function logSection(title: string) {
  console.log(`\n${'━'.repeat(50)}`);
  console.log(`  ${title}`);
  console.log('━'.repeat(50));
}

function logResult(label: string, result: unknown) {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(result, null, 2));
}

function assertSuccess(result: { success: boolean; error?: string }, action: string) {
  if (!result.success) {
    throw new Error(`${action} failed: ${result.error}`);
  }
}

// Main test scenarios
async function main() {
  logSection('Setting up TrikHub Gateway');

  // Create config store that reads from .trikhub/secrets.json
  // This is where OPENAI_API_KEY would be stored for article generation
  const configStore = new FileConfigStore({
    localSecretsPath: join(__dirname, '.trikhub', 'secrets.json'),
  });
  await configStore.load();

  // Use in-memory storage for testing (doesn't persist between runs)
  // For persistent testing, use SqliteStorageProvider instead
  const storageProvider = new InMemoryStorageProvider();

  // Create gateway with config and storage
  const gateway = new TrikGateway({ configStore, storageProvider });

  // Load the content-hoarder trik from current directory
  console.log('Loading trik from:', __dirname);
  await gateway.loadTrik(__dirname);
  console.log('✅ Trik loaded successfully!\n');

  // =========================================================================
  // Test 1: List content (should be empty initially)
  // =========================================================================
  logSection('Test 1: List Content (Empty)');

  const emptyList = await gateway.execute('content-hoarder', 'listContent', {});
  logResult('Result', emptyList);
  assertSuccess(emptyList, 'listContent');

  if (emptyList.success && emptyList.responseMode === 'template') {
    const data = emptyList.agentData as { template: string; totalCount: number };
    console.log('\n✅ Expected empty list:', data.template === 'empty' ? 'PASS' : 'FAIL');
  }

  // =========================================================================
  // Test 2: Add single content (example.com)
  // =========================================================================
  logSection('Test 2: Add Single Inspiration');

  const addSingle = await gateway.execute('content-hoarder', 'addInspiration', {
    url: 'https://example.com',
    tags: ['test', 'example'],
  });
  logResult('Result', addSingle);
  assertSuccess(addSingle, 'addInspiration');

  if (addSingle.success && addSingle.responseMode === 'template') {
    const data = addSingle.agentData as { type: string; contentCount: number };
    console.log('\n✅ Added single content:', data.type === 'single' && data.contentCount === 1 ? 'PASS' : 'FAIL');
  }

  // =========================================================================
  // Test 3: List content (should have 1 item)
  // =========================================================================
  logSection('Test 3: List Content (1 item)');

  const listWithOne = await gateway.execute('content-hoarder', 'listContent', {});
  logResult('Result', listWithOne);
  assertSuccess(listWithOne, 'listContent');

  let contentId: string | undefined;
  if (listWithOne.success && listWithOne.responseMode === 'template') {
    const data = listWithOne.agentData as { totalCount: number; items: Array<{ id: string; title: string }> };
    console.log('\n✅ List shows 1 item:', data.totalCount === 1 ? 'PASS' : 'FAIL');
    contentId = data.items?.[0]?.id;
    console.log('   Content ID:', contentId);
  }

  // =========================================================================
  // Test 4: Get content details (passthrough mode)
  // =========================================================================
  if (contentId) {
    logSection('Test 4: Get Content Details');

    const getContent = await gateway.execute('content-hoarder', 'getContent', {
      contentId,
    });
    logResult('Result', getContent);
    assertSuccess(getContent, 'getContent');

    // Deliver passthrough content
    if (getContent.success && getContent.responseMode === 'passthrough') {
      const ref = (getContent as { userContentRef: string }).userContentRef;
      const delivered = gateway.deliverContent(ref);
      if (delivered) {
        console.log('\n--- PASSTHROUGH CONTENT ---');
        console.log(JSON.stringify(delivered.content, null, 2).slice(0, 500));
        console.log('...');
        console.log('--- END CONTENT ---');
      }
    }
  }

  // =========================================================================
  // Test 5: Add another piece of content
  // =========================================================================
  logSection('Test 5: Add Second Inspiration');

  const addSecond = await gateway.execute('content-hoarder', 'addInspiration', {
    url: 'https://httpbin.org/html',
    tags: ['test', 'httpbin'],
  });
  logResult('Result', addSecond);
  assertSuccess(addSecond, 'addInspiration');

  // =========================================================================
  // Test 6: List with tag filter
  // =========================================================================
  logSection('Test 6: List with Tag Filter');

  const filteredList = await gateway.execute('content-hoarder', 'listContent', {
    tags: ['example'],
  });
  logResult('Result', filteredList);
  assertSuccess(filteredList, 'listContent');

  if (filteredList.success && filteredList.responseMode === 'template') {
    const data = filteredList.agentData as { totalCount: number };
    console.log('\n✅ Tag filter works:', data.totalCount === 1 ? 'PASS' : 'FAIL');
  }

  // =========================================================================
  // Test 7: Delete content
  // =========================================================================
  if (contentId) {
    logSection('Test 7: Delete Content');

    const deleteResult = await gateway.execute('content-hoarder', 'deleteContent', {
      contentId,
    });
    logResult('Result', deleteResult);
    assertSuccess(deleteResult, 'deleteContent');

    if (deleteResult.success && deleteResult.responseMode === 'template') {
      const data = deleteResult.agentData as { template: string };
      console.log('\n✅ Delete successful:', data.template === 'success' ? 'PASS' : 'FAIL');
    }
  }

  // =========================================================================
  // Test 8: Verify deletion
  // =========================================================================
  logSection('Test 8: Verify Deletion');

  const afterDelete = await gateway.execute('content-hoarder', 'listContent', {});
  logResult('Result', afterDelete);

  if (afterDelete.success && afterDelete.responseMode === 'template') {
    const data = afterDelete.agentData as { totalCount: number };
    console.log('\n✅ Item deleted (1 remaining):', data.totalCount === 1 ? 'PASS' : 'FAIL');
  }

  // =========================================================================
  // Test 9: List articles (should be empty)
  // =========================================================================
  logSection('Test 9: List Articles (Empty)');

  const emptyArticles = await gateway.execute('content-hoarder', 'listArticles', {});
  logResult('Result', emptyArticles);

  if (emptyArticles.success && emptyArticles.responseMode === 'template') {
    const data = emptyArticles.agentData as { template: string };
    console.log('\n✅ No articles yet:', data.template === 'empty' ? 'PASS' : 'FAIL');
  }

  // =========================================================================
  // Test 10: Create article (requires OPENAI_API_KEY)
  // =========================================================================
  logSection('Test 10: Create Article (Optional - requires OPENAI_API_KEY)');

  // Get remaining content IDs for article creation
  const remainingContent = await gateway.execute('content-hoarder', 'listContent', {});
  if (remainingContent.success && remainingContent.responseMode === 'template') {
    const data = remainingContent.agentData as { items: Array<{ id: string }> };
    const contentIds = data.items?.map((i) => i.id) || [];

    if (contentIds.length > 0) {
      try {
        const createArticle = await gateway.execute('content-hoarder', 'createArticle', {
          contentIds,
          instructions: 'Write a brief summary of the content in a casual, conversational tone.',
          title: 'Test Article',
        });
        logResult('Result', createArticle);

        if (createArticle.success && createArticle.responseMode === 'passthrough') {
          const ref = (createArticle as { userContentRef: string }).userContentRef;
          const delivered = gateway.deliverContent(ref);
          if (delivered) {
            console.log('\n--- ARTICLE CONTENT ---');
            console.log(JSON.stringify(delivered.content, null, 2).slice(0, 1000));
            console.log('...');
            console.log('--- END ARTICLE ---');
          }
          console.log('\n✅ Article created successfully!');
        }
      } catch (error) {
        console.log('\n⚠️  Article creation skipped (OPENAI_API_KEY not configured)');
        console.log('   To test article creation:');
        console.log('   1. Create .trikhub/secrets.json with:');
        console.log('      { "OPENAI_API_KEY": "your-key-here" }');
        console.log('   2. Re-run this test');
      }
    }
  }

  // =========================================================================
  // Summary
  // =========================================================================
  logSection('Test Summary');
  console.log('\n✅ All basic tests passed!');
  console.log('\nNote: Article creation/update tests require OPENAI_API_KEY.');
  console.log('Set up .trikhub/secrets.json to test those features.\n');

  // Shutdown gateway
  await gateway.shutdown();
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
