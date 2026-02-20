# Content Hoarder

Collect content from URLs and feeds, then create articles in your voice.

## Features

- **Add Inspirations**: Paste URLs (single articles or RSS feeds) to collect content
- **Auto-detect Feeds**: Automatically detects and processes RSS/Atom feeds
- **Content Storage**: Persistently stores extracted content with tags
- **Article Generation**: Create articles from multiple content pieces using AI
- **Iterative Editing**: Refine articles with additional instructions

## Actions

| Action | Mode | Description |
|--------|------|-------------|
| `addInspiration` | Template | Add URL as inspiration (single or feed) |
| `listContent` | Template | List stored content pieces with filtering |
| `getContent` | Passthrough | Get full content of a specific piece |
| `createArticle` | Passthrough | Generate article from selected content |
| `listArticles` | Template | List all created articles |
| `updateArticle` | Passthrough | Edit and iterate on an article |
| `deleteContent` | Template | Remove a content piece |

## Configuration

Requires:
- `OPENAI_API_KEY` - OpenAI API key for article generation

## Usage Examples

### Add content from a blog post
```
Add this article as inspiration: https://example.com/great-post
```

### Add content from an RSS feed
```
Add all articles from this feed: https://blog.example.com/rss
```

### Create an article
```
Create an article about AI trends using my saved content.
Make it conversational and add my perspective as a developer.
```

### Refine an article
```
Update article ABC123 to be more concise and add a conclusion.
```

## Development

```bash
npm install
npm run build
npm test
```

## Publishing

```bash
trik lint .
trik publish
```

## Architecture

This trik uses:
- **rss-parser**: For RSS/Atom feed parsing
- **node-html-parser**: For extracting content from web pages
- **OpenAI GPT-4o**: For article generation and editing

Storage is handled through the TrikHub gateway's persistent storage API.
