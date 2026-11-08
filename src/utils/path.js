/**
 * Path normalization utilities to protect against high-cardinality Prometheus labels.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_REGEX = /^\d+$/;
const MONGODB_OBJECTID_REGEX = /^[0-9a-f]{24}$/i;
const HASH_REGEX = /^[0-9a-f]{32,64}$/i;
const TOKEN_PREFIX_REGEX = /^(ch|cus|pi|txn|inv|sub|in|evt|file|tok|usr|ord|sess)_[a-zA-Z0-9]{10,}$/i;

/**
 * Normalizes a URL path by replacing dynamic identifiers (numbers, UUIDs, ObjectIds, hashes, tokens)
 * with placeholder tokens like `:id` to prevent Prometheus label cardinality explosion.
 *
 * @param {string} rawPath
 * @returns {string}
 */
export function normalizePath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return '/';

    const cleanPath = rawPath.split('?')[0].split('#')[0];
    if (cleanPath === '' || cleanPath === '/') return '/';

    const segments = cleanPath.split('/').filter(Boolean);
    const normalized = segments.map((seg) => {
        if (
            NUMERIC_REGEX.test(seg) ||
            UUID_REGEX.test(seg) ||
            MONGODB_OBJECTID_REGEX.test(seg) ||
            HASH_REGEX.test(seg) ||
            TOKEN_PREFIX_REGEX.test(seg)
        ) {
            return ':id';
        }
        return seg;
    });

    return '/' + normalized.join('/');
}
