/**
 * Pagination helpers for list endpoints.
 * Safe defaults and caps for Lambda + large collections.
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse page and limit from query params with safe bounds.
 * Returns null if neither page nor limit is provided (backward compatible).
 * @param {Object} query - event.queryStringParameters or similar
 * @param {{ defaultLimit?: number, maxLimit?: number }} opts
 * @returns {{ page: number, limit: number, skip: number } | null}
 */
function parsePagination(query = {}, opts = {}) {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = Math.min(opts.maxLimit ?? MAX_LIMIT, 500);

  const hasPage = query.page !== undefined && query.page !== null && query.page !== '';
  const hasLimit = query.limit !== undefined && query.limit !== null && query.limit !== '';

  // Backward compatible: only paginate if page or limit is explicitly provided
  if (!hasPage && !hasLimit) {
    return null;
  }

  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (!Number.isFinite(page) || page < 1) page = DEFAULT_PAGE;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * Build meta object for list response.
 * @param {{ page: number, limit: number }} pagination
 * @param {number} total
 */
function paginationMeta(pagination, total) {
  const { page, limit } = pagination;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
  };
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  paginationMeta,
};
