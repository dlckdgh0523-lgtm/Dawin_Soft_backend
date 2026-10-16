# Daily AI and IT news drafts

Enable `newsEnabled` with `mode: AUTO_DRAFT`, `enabled`, `collectEnabled`, `aiEnabled`, approved sources and existing AI privacy/model/budget settings. Configure `newsFeeds` with approved HTTPS RSS URLs and add their exact hosts to `allowedHosts`.

Production feeds:
- https://github.blog/feed/
- https://aws.amazon.com/blogs/machine-learning/feed/

With `collectionHour: 9`, the worker discovers at 09:00 Asia/Seoul and writes at 10:00. A late worker catches up within the same day. The news scheduler replaces the legacy topic scheduler when enabled.

Only dated items within the last seven days are eligible. URLs are canonicalized without query parameters, future/undated items and unapproved hosts are rejected, and already used source URLs are excluded. Up to three independent collection jobs allow another source to work if one fails. RSS summaries are never used as article evidence: a separate successful HTML extraction is required. Exact bounded evidence spans are marked for extraction integrity; the AI fact review and eventual human publication review remain separate.

A durable per-day run and idempotent generation key limit automatic writing to one news job per Korean calendar day. Existing manual news generation also consumes that day's allowance. Successful proposals are saved through the normal article API as private news drafts. Set `newsAutoPublish: true` only when the owner authorizes automatic publication. All four AI stage records and a final review with no outstanding issues are required. Exact source validation, privacy/experience and requested punctuation checks run before approval. The normal approval and publication APIs record an explicitly automated review and publish only the unchanged generated revision. Edited or flagged drafts stay private, and disabling automatic publication fences already queued automated jobs. The public article identifies AI writing and automated verification. Review issues remain on the generation job. Failed jobs and missing recent sources are visible in editorial runs; they do not trigger unbounded AI retries. Feed transport failures retry up to three times at 15-minute intervals. Stale discovery claims recover after five minutes; completed draft application is restart-safe.

Existing request, daily and monthly dollar limits apply to all four AI stages. Production keeps the previously agreed daily USD 0.05 and monthly USD 1 caps. RSS discovery does not call an AI provider. Stop through the existing pause control; disabling `newsEnabled` restores the legacy scheduler.

Validation: `npm run check`, `npm run build`, `npm run test:editorial`. Live RSS smoke test should use `collectSource` to exercise DNS pinning, response bounds and the isolated XML parser.
