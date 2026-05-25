import ipRangeCheck from 'ip-range-check';

const getClientIp = (req, trustProxy) => {
    if (trustProxy) {
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded) {
            return forwarded.split(',')[0].trim();
        }
    }
    return req.ip || req.connection.remoteAddress || '';
};

const parseAllowedIPs = (raw) => {
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
};

const ipAllowlistMiddleware = ({ allowedIPs = '', trustProxy = false } = {}) => {
    const allowlist = parseAllowedIPs(allowedIPs);

    return (req, res, next) => {
        if (allowlist.length === 0) return next();

        const clientIp = getClientIp(req, trustProxy);

        if (ipRangeCheck(clientIp, allowlist)) {
            return next();
        }

        res.status(403).json({ error: 'Forbidden — IP not in allowlist' });
    };
};

export { ipAllowlistMiddleware };
