const readinessChecks = [];

const registerReadinessCheck = ({ name, check }) => {
    readinessChecks.push({ name, check });
};

const readinessHandler = () => {
    return async (_req, res) => {
        const failing = [];

        await Promise.all(
            readinessChecks.map(async ({ name, check }) => {
                try {
                    await check();
                } catch (_err) {
                    failing.push(name);
                }
            })
        );

        if (failing.length === 0) {
            return res.status(200).json({ status: 'ready' });
        }

        return res.status(503).json({ status: 'not ready', failing });
    };
};

export { registerReadinessCheck, readinessHandler };
