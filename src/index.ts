/**
 * Content Hoarder
 * Collect content from URLs and feeds, then create articles in your voice
 */

import Parser from 'rss-parser';
import { parse as parseHtml } from 'node-html-parser';
import OpenAI from 'openai';
import crypto from 'crypto';

// =============================================================================
// Types
// =============================================================================

interface ContentPiece {
  id: string;
  title: string;
  source: string;
  content: string;
  summary?: string;
  tags: string[];
  addedAt: string;
  inspirationType: 'single' | 'feed';
}

interface Article {
  id: string;
  title: string;
  content: string;
  sourceContentIds: string[];
  instructions: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Storage proxy interface (provided by TrikHub gateway)
interface StorageProxy {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  getMany(keys: string[]): Promise<Record<string, unknown>>;
  setMany(entries: Record<string, unknown>): Promise<void>;
}

// Config context interface (provided by TrikHub gateway)
interface ConfigContext {
  get(key: string): string | undefined;
  has(key: string): boolean;
  keys(): string[];
}

// =============================================================================
// Storage Keys
// =============================================================================

const STORAGE_KEYS = {
  content: (id: string) => `content:${id}`,
  contentIndex: 'content:index',
  article: (id: string) => `article:${id}`,
  articleIndex: 'article:index',
};

// =============================================================================
// Helpers
// =============================================================================

const rssParser = new Parser();

function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function getOpenAI(config?: ConfigContext): OpenAI {
  const apiKey = config?.get('OPENAI_API_KEY') || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  return new OpenAI({ apiKey });
}

async function detectUrlType(url: string): Promise<'single' | 'feed'> {
  try {
    await rssParser.parseURL(url);
    return 'feed';
  } catch {
    return 'single';
  }
}

async function fetchSingleContent(url: string): Promise<{ title: string; content: string }> {
  const response = await fetch(url);
  const html = await response.text();
  const root = parseHtml(html);

  const title =
    root.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    root.querySelector('title')?.text ||
    'Untitled';

  const contentSelectors = ['article', 'main', '.post-content', '.entry-content', '.article-body', '#content'];
  let content = '';

  for (const selector of contentSelectors) {
    const element = root.querySelector(selector);
    if (element) {
      content = element.text.trim();
      break;
    }
  }

  if (!content) {
    content = root.querySelector('body')?.text.trim() || '';
  }

  content = content.replace(/\s+/g, ' ').trim();
  return { title, content };
}

async function fetchFeedContent(url: string): Promise<Array<{ title: string; content: string; link: string }>> {
  const feed = await rssParser.parseURL(url);
  return feed.items.map((item) => ({
    title: item.title || 'Untitled',
    content: item.contentSnippet || item.content || item.summary || '',
    link: item.link || url,
  }));
}

// =============================================================================
// Storage Helpers
// =============================================================================

async function getContentIndex(storage: StorageProxy): Promise<string[]> {
  const index = await storage.get(STORAGE_KEYS.contentIndex);
  return (index as string[]) || [];
}

async function setContentIndex(storage: StorageProxy, index: string[]): Promise<void> {
  await storage.set(STORAGE_KEYS.contentIndex, index);
}

async function getContent(storage: StorageProxy, id: string): Promise<ContentPiece | null> {
  const content = await storage.get(STORAGE_KEYS.content(id));
  return (content as ContentPiece) || null;
}

async function setContent(storage: StorageProxy, content: ContentPiece): Promise<void> {
  await storage.set(STORAGE_KEYS.content(content.id), content);
  const index = await getContentIndex(storage);
  if (!index.includes(content.id)) {
    await setContentIndex(storage, [...index, content.id]);
  }
}

async function deleteContentById(storage: StorageProxy, id: string): Promise<boolean> {
  const deleted = await storage.delete(STORAGE_KEYS.content(id));
  if (deleted) {
    const index = await getContentIndex(storage);
    await setContentIndex(storage, index.filter((i) => i !== id));
  }
  return deleted;
}

async function getArticleIndex(storage: StorageProxy): Promise<string[]> {
  const index = await storage.get(STORAGE_KEYS.articleIndex);
  return (index as string[]) || [];
}

async function setArticleIndex(storage: StorageProxy, index: string[]): Promise<void> {
  await storage.set(STORAGE_KEYS.articleIndex, index);
}

async function getArticle(storage: StorageProxy, id: string): Promise<Article | null> {
  const article = await storage.get(STORAGE_KEYS.article(id));
  return (article as Article) || null;
}

async function setArticle(storage: StorageProxy, article: Article): Promise<void> {
  await storage.set(STORAGE_KEYS.article(article.id), article);
  const index = await getArticleIndex(storage);
  if (!index.includes(article.id)) {
    await setArticleIndex(storage, [...index, article.id]);
  }
}

// =============================================================================
// Action Handlers
// =============================================================================

type ActionInput = Record<string, unknown>;
type ActionResult = {
  responseMode: 'template' | 'passthrough';
  agentData?: Record<string, unknown>;
  userContent?: Record<string, unknown>;
};

async function addInspiration(
  input: ActionInput,
  storage: StorageProxy
): Promise<ActionResult> {
  const url = input.url as string;
  const tags = (input.tags as string[]) || [];

  try {
    const urlType = await detectUrlType(url);

    if (urlType === 'feed') {
      const items = await fetchFeedContent(url);

      for (const item of items) {
        const id = generateId();
        await setContent(storage, {
          id,
          title: item.title,
          source: item.link,
          content: item.content,
          tags,
          addedAt: new Date().toISOString(),
          inspirationType: 'feed',
        });
      }

      return {
        responseMode: 'template',
        agentData: {
          template: 'success',
          type: 'feed',
          contentCount: items.length,
        },
      };
    } else {
      const { title, content } = await fetchSingleContent(url);
      const id = generateId();

      await setContent(storage, {
        id,
        title,
        source: url,
        content,
        tags,
        addedAt: new Date().toISOString(),
        inspirationType: 'single',
      });

      return {
        responseMode: 'template',
        agentData: {
          template: 'success',
          type: 'single',
          contentCount: 1,
        },
      };
    }
  } catch (error) {
    return {
      responseMode: 'template',
      agentData: {
        template: 'error',
        type: 'single',
        contentCount: 0,
      },
    };
  }
}

async function listContent(
  input: ActionInput,
  storage: StorageProxy
): Promise<ActionResult> {
  const filterTags = (input.tags as string[]) || [];
  const limit = (input.limit as number) || 20;
  const offset = (input.offset as number) || 0;

  const index = await getContentIndex(storage);

  if (index.length === 0) {
    return {
      responseMode: 'template',
      agentData: {
        template: 'empty',
        totalCount: 0,
        returnedCount: 0,
      },
    };
  }

  // Fetch all content pieces
  const allContent: ContentPiece[] = [];
  for (const id of index) {
    const content = await getContent(storage, id);
    if (content) {
      allContent.push(content);
    }
  }

  // Filter by tags if provided
  let filtered = allContent;
  if (filterTags.length > 0) {
    filtered = allContent.filter((item) =>
      filterTags.some((tag) => item.tags.includes(tag))
    );
  }

  // Sort by date (newest first)
  filtered.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    responseMode: 'template',
    agentData: {
      template: 'success',
      totalCount: total,
      returnedCount: paginated.length,
      items: paginated.map((c) => ({
        id: c.id,
        title: c.title,
        source: c.source,
        tags: c.tags,
        addedAt: c.addedAt,
      })),
    },
  };
}

async function getContentAction(
  input: ActionInput,
  storage: StorageProxy
): Promise<ActionResult> {
  const contentId = input.contentId as string;
  const content = await getContent(storage, contentId);

  if (!content) {
    return {
      responseMode: 'passthrough',
      userContent: {
        contentType: 'error',
        content: 'Content not found',
      },
    };
  }

  return {
    responseMode: 'passthrough',
    userContent: {
      contentType: 'content',
      content: `# ${content.title}\n\n**Source:** ${content.source}\n**Tags:** ${content.tags.join(', ') || 'none'}\n**Added:** ${content.addedAt}\n\n---\n\n${content.content}`,
      metadata: {
        title: content.title,
        source: content.source,
        tags: content.tags,
        addedAt: content.addedAt,
      },
    },
  };
}

async function createArticle(
  input: ActionInput,
  storage: StorageProxy,
  config?: ConfigContext
): Promise<ActionResult> {
  const contentIds = input.contentIds as string[];
  const instructions = input.instructions as string;
  const title = input.title as string | undefined;

  // Gather source content
  const sourceContent: string[] = [];
  for (const id of contentIds) {
    const content = await getContent(storage, id);
    if (content) {
      sourceContent.push(`## ${content.title}\nSource: ${content.source}\n\n${content.content}`);
    }
  }

  if (sourceContent.length === 0) {
    return {
      responseMode: 'passthrough',
      userContent: {
        contentType: 'error',
        content: 'No valid content pieces found',
      },
    };
  }

  // Generate article using OpenAI
  const openai = getOpenAI(config);

  const prompt = `Based on the following source materials, create an article following these instructions:

INSTRUCTIONS: ${instructions}

SOURCE MATERIALS:
${sourceContent.join('\n\n---\n\n')}

Write a well-structured article that synthesizes the key points from these sources while following the user's instructions for tone and style. ${title ? `The article should be titled: "${title}"` : 'Generate an appropriate title.'}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a skilled writer who creates engaging articles based on source materials. Maintain the user\'s voice and style as specified in their instructions.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 4000,
  });

  const generatedContent = completion.choices[0]?.message?.content || '';
  const articleTitle = title || generatedContent.match(/^#\s+(.+)$/m)?.[1] || 'Untitled Article';

  const articleId = generateId();
  await setArticle(storage, {
    id: articleId,
    title: articleTitle,
    content: generatedContent,
    sourceContentIds: contentIds,
    instructions,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return {
    responseMode: 'passthrough',
    userContent: {
      contentType: 'article',
      content: `# ${articleTitle}\n\n${generatedContent}`,
      metadata: {
        articleId,
        title: articleTitle,
      },
    },
  };
}

async function listArticles(
  input: ActionInput,
  storage: StorageProxy
): Promise<ActionResult> {
  const limit = (input.limit as number) || 20;
  const offset = (input.offset as number) || 0;

  const index = await getArticleIndex(storage);

  if (index.length === 0) {
    return {
      responseMode: 'template',
      agentData: {
        template: 'empty',
        totalCount: 0,
        returnedCount: 0,
      },
    };
  }

  const allArticles: Article[] = [];
  for (const id of index) {
    const article = await getArticle(storage, id);
    if (article) {
      allArticles.push(article);
    }
  }

  allArticles.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const total = allArticles.length;
  const paginated = allArticles.slice(offset, offset + limit);

  return {
    responseMode: 'template',
    agentData: {
      template: 'success',
      totalCount: total,
      returnedCount: paginated.length,
      items: paginated.map((a) => ({
        id: a.id,
        title: a.title,
        version: a.version,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    },
  };
}

async function updateArticle(
  input: ActionInput,
  storage: StorageProxy,
  config?: ConfigContext
): Promise<ActionResult> {
  const articleId = input.articleId as string;
  const instructions = input.instructions as string;
  const additionalContentIds = (input.additionalContentIds as string[]) || [];

  const article = await getArticle(storage, articleId);
  if (!article) {
    return {
      responseMode: 'passthrough',
      userContent: {
        contentType: 'error',
        content: 'Article not found',
      },
    };
  }

  // Gather additional source content if provided
  const additionalContent: string[] = [];
  for (const id of additionalContentIds) {
    const content = await getContent(storage, id);
    if (content) {
      additionalContent.push(`## ${content.title}\nSource: ${content.source}\n\n${content.content}`);
    }
  }

  const openai = getOpenAI(config);

  let prompt = `Here is an existing article that needs to be revised:

CURRENT ARTICLE:
${article.content}

REVISION INSTRUCTIONS: ${instructions}`;

  if (additionalContent.length > 0) {
    prompt += `\n\nADDITIONAL SOURCE MATERIALS TO INCORPORATE:
${additionalContent.join('\n\n---\n\n')}`;
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a skilled editor who revises articles based on feedback while maintaining consistency with the original voice and style.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 4000,
  });

  const updatedContent = completion.choices[0]?.message?.content || article.content;

  article.content = updatedContent;
  article.version += 1;
  article.updatedAt = new Date().toISOString();
  if (additionalContentIds.length > 0) {
    article.sourceContentIds = [...new Set([...article.sourceContentIds, ...additionalContentIds])];
  }

  await setArticle(storage, article);

  return {
    responseMode: 'passthrough',
    userContent: {
      contentType: 'article',
      content: `# ${article.title}\n\n${updatedContent}`,
      metadata: {
        articleId: article.id,
        title: article.title,
        version: article.version,
      },
    },
  };
}

async function deleteContent(
  input: ActionInput,
  storage: StorageProxy
): Promise<ActionResult> {
  const contentId = input.contentId as string;
  const deleted = await deleteContentById(storage, contentId);

  if (!deleted) {
    return {
      responseMode: 'template',
      agentData: { template: 'notFound' },
    };
  }

  return {
    responseMode: 'template',
    agentData: { template: 'success' },
  };
}

// =============================================================================
// Main Trik Class
// =============================================================================

type InvokeInput = {
  action: string;
  input: Record<string, unknown>;
  storage?: StorageProxy;
  config?: ConfigContext;
};

class ContentHoarderTrik {
  async invoke(input: InvokeInput): Promise<ActionResult> {
    const { action, input: actionInput, storage, config } = input;

    if (!storage) {
      return {
        responseMode: 'template',
        agentData: {
          template: 'error',
          message: 'Storage not provided',
        },
      };
    }

    try {
      switch (action) {
        case 'addInspiration':
          return await addInspiration(actionInput, storage);
        case 'listContent':
          return await listContent(actionInput, storage);
        case 'getContent':
          return await getContentAction(actionInput, storage);
        case 'createArticle':
          return await createArticle(actionInput, storage, config);
        case 'listArticles':
          return await listArticles(actionInput, storage);
        case 'updateArticle':
          return await updateArticle(actionInput, storage, config);
        case 'deleteContent':
          return await deleteContent(actionInput, storage);
        default:
          return {
            responseMode: 'template',
            agentData: {
              template: 'error',
              message: `Unknown action: ${action}`,
            },
          };
      }
    } catch (error) {
      return {
        responseMode: 'template',
        agentData: {
          template: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

export default new ContentHoarderTrik();
