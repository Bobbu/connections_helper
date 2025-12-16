# PRD: Connections Helper Web Service

## Overview

Deploy the NYT Connections Helper as a web service accessible at `connections-helper.anystupididea.com`. The service displays today's puzzle words with their definitions in a nicely formatted HTML page.

## User Stories

1. **As a user**, I want to visit `connections-helper.anystupididea.com` and see today's Connections puzzle words with their meanings, so I can solve the puzzle more effectively.

2. **As a user**, I want fast page loads, so I don't have to wait for scraping to complete on every request.

## Requirements

### Functional Requirements

1. **Web Endpoint**: GET request to `connections-helper.anystupididea.com` returns an HTML page
2. **Content**: Display 16 puzzle words with:
   - Dictionary definitions (up to 3 per word)
   - Cultural references where applicable
   - "Shuffle immediately" tip
3. **Daily Caching**: Fetch puzzle data once per day; subsequent requests serve cached data
4. **Timezone**: Puzzle resets at midnight Eastern Time

### Non-Functional Requirements

1. **One-Click Deployment**: CDK stack deployable via single command (scorched earth philosophy)
2. **Cost Efficient**: Serverless, pay-per-use model
3. **Fast Response**: Cached responses should return in <500ms

## Technical Constraints

1. **NYT API**: Discovered that NYT exposes a public JSON API at `https://www.nytimes.com/svc/connections/v2/{date}.json` - no Puppeteer/scraping needed!

2. **Existing Infrastructure**: No current `anystupididea.com` hosted zone exists; must be created

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Route 53                                 │
│            connections-helper.anystupididea.com                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Gateway                                 │
│                    (Custom Domain)                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Lambda (Serve)                                │
│              - Check DynamoDB for today's data                   │
│              - Return cached HTML if exists                      │
│              - Trigger fetch if missing                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
┌─────────────────────┐   ┌─────────────────────────────────────┐
│     DynamoDB        │   │     Lambda (Fetch)                  │
│  - puzzle_date (PK) │   │  - NYT API call                     │
│  - words[]          │   │  - Dictionary API calls             │
│  - fetched_at       │   │  - Stores results in DynamoDB       │
│  - TTL (auto-expire)│   └─────────────────────────────────────┘
└─────────────────────┘

EventBridge scheduled rule triggers fetch at 12:05 AM ET daily
```

## Implemented Architecture

With the NYT API discovery, we implemented the simpler approach:

1. **Scheduled Fetch**: EventBridge triggers standard Node.js Lambda at 12:05 AM ET daily
2. **Simple Serve Lambda**: Just reads from DynamoDB, returns HTML
3. **Fallback**: If no data for today, return "Puzzle not yet available" message

This separates concerns and ensures fast response times. No Docker/Puppeteer complexity needed.

## Data Model (DynamoDB)

```
Table: connections-helper-puzzles

{
  puzzle_date: "2025-12-14",     // Partition Key (YYYY-MM-DD in ET)
  words: [
    {
      word: "DUCKLING",
      definitions: ["(noun) A young duck."],
      cultural_ref: "The Ugly Duckling (fairy tale)"
    },
    ...
  ],
  fetched_at: "2025-12-14T00:05:00Z",
  ttl: 1734393600                 // Auto-expire after 7 days
}
```

## Open Questions

1. Should we also support an API endpoint (JSON response) in addition to HTML?
2. What should happen if the puzzle fetch fails? Retry logic? Alert?
3. Should we keep historical puzzles accessible (e.g., `/2025-12-13`)?

## Success Metrics

1. Page loads in <1 second for cached responses
2. Daily puzzle available by 12:10 AM ET
3. Zero manual intervention required for daily operation
