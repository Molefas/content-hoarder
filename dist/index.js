/**
 * Content Hoarder
 * Collect content from URLs and feeds, then create articles in your voice
 */
import Parser from 'rss-parser';
import { parse as parseHtml } from 'node-html-parser';
import OpenAI from 'openai';
import crypto from 'crypto';
// =============================================================================
// Storage Keys
// =============================================================================
const STORAGE_KEYS = {
    content: (id) => `content:${id}`,
    contentIndex: 'content:index',
    article: (id) => `article:${id}`,
    articleIndex: 'article:index',
};
// =============================================================================
// Helpers
// =============================================================================
const rssParser = new Parser();
function generateId() {
    return crypto.randomBytes(8).toString('hex');
}
function getOpenAI(config) {
    const apiKey = config?.get('OPENAI_API_KEY') || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
    }
    return new OpenAI({ apiKey });
}
async function detectUrlType(url) {
    try {
        await rssParser.parseURL(url);
        return 'feed';
    }
    catch {
        return 'single';
    }
}
async function fetchSingleContent(url) {
    const response = await fetch(url);
    const html = await response.text();
    const root = parseHtml(html);
    const title = root.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
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
async function fetchFeedContent(url) {
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
async function getContentIndex(storage) {
    const index = await storage.get(STORAGE_KEYS.contentIndex);
    return index || [];
}
async function setContentIndex(storage, index) {
    await storage.set(STORAGE_KEYS.contentIndex, index);
}
async function getContent(storage, id) {
    const content = await storage.get(STORAGE_KEYS.content(id));
    return content || null;
}
async function setContent(storage, content) {
    await storage.set(STORAGE_KEYS.content(content.id), content);
    const index = await getContentIndex(storage);
    if (!index.includes(content.id)) {
        await setContentIndex(storage, [...index, content.id]);
    }
}
async function deleteContentById(storage, id) {
    const deleted = await storage.delete(STORAGE_KEYS.content(id));
    if (deleted) {
        const index = await getContentIndex(storage);
        await setContentIndex(storage, index.filter((i) => i !== id));
    }
    return deleted;
}
async function getArticleIndex(storage) {
    const index = await storage.get(STORAGE_KEYS.articleIndex);
    return index || [];
}
async function setArticleIndex(storage, index) {
    await storage.set(STORAGE_KEYS.articleIndex, index);
}
async function getArticle(storage, id) {
    const article = await storage.get(STORAGE_KEYS.article(id));
    return article || null;
}
async function setArticle(storage, article) {
    await storage.set(STORAGE_KEYS.article(article.id), article);
    const index = await getArticleIndex(storage);
    if (!index.includes(article.id)) {
        await setArticleIndex(storage, [...index, article.id]);
    }
}
async function addInspiration(input, storage) {
    const url = input.url;
    const tags = input.tags || [];
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
        }
        else {
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
    }
    catch (error) {
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
async function listContent(input, storage) {
    const filterTags = input.tags || [];
    const limit = input.limit || 20;
    const offset = input.offset || 0;
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
    const allContent = [];
    for (const id of index) {
        const content = await getContent(storage, id);
        if (content) {
            allContent.push(content);
        }
    }
    // Filter by tags if provided
    let filtered = allContent;
    if (filterTags.length > 0) {
        filtered = allContent.filter((item) => filterTags.some((tag) => item.tags.includes(tag)));
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
async function getContentAction(input, storage) {
    const contentId = input.contentId;
    const content = await getContent(storage, contentId);
    if (!content) {
        return {
            responseMode: 'passthrough',
            userContent: { error: 'Content not found' },
        };
    }
    return {
        responseMode: 'passthrough',
        userContent: {
            title: content.title,
            source: content.source,
            content: content.content,
            tags: content.tags,
            addedAt: content.addedAt,
        },
    };
}
async function createArticle(input, storage, config) {
    const contentIds = input.contentIds;
    const instructions = input.instructions;
    const title = input.title;
    // Gather source content
    const sourceContent = [];
    for (const id of contentIds) {
        const content = await getContent(storage, id);
        if (content) {
            sourceContent.push(`## ${content.title}\nSource: ${content.source}\n\n${content.content}`);
        }
    }
    if (sourceContent.length === 0) {
        return {
            responseMode: 'passthrough',
            userContent: { error: 'No valid content pieces found' },
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
            articleId,
            title: articleTitle,
            content: generatedContent,
        },
    };
}
async function listArticles(input, storage) {
    const limit = input.limit || 20;
    const offset = input.offset || 0;
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
    const allArticles = [];
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
async function updateArticle(input, storage, config) {
    const articleId = input.articleId;
    const instructions = input.instructions;
    const additionalContentIds = input.additionalContentIds || [];
    const article = await getArticle(storage, articleId);
    if (!article) {
        return {
            responseMode: 'passthrough',
            userContent: { error: 'Article not found' },
        };
    }
    // Gather additional source content if provided
    const additionalContent = [];
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
            articleId: article.id,
            title: article.title,
            content: updatedContent,
            version: article.version,
        },
    };
}
async function deleteContent(input, storage) {
    const contentId = input.contentId;
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
class ContentHoarderTrik {
    async invoke(input) {
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
        }
        catch (error) {
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
