---
name: exports
description: 'Export data as CSV or PDF. Use when people need to take their data out.'
metadata:
  family: opinion
  author: pono
---

- CSV in UTF-8 with a header row, dates in ISO 8601.
- Large exports run as background jobs and are delivered by a link that expires.
- An export only contains what the person may read, and is journaled.
