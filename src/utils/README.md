# Utilities

## `logger.js`

Structured logger for consistent logs (CloudWatch-friendly).

Usage:

```js
const logger = require("./logger");
logger.info("something happened", { requestId });
logger.error("something failed", err, { requestId });
```

## `response.js`

Helpers to build Lambda HTTP responses:

- `json(statusCode, body, headers?)`
- `text(statusCode, body, contentType?, headers?)`

