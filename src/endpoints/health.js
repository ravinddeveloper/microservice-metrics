const healthHandler = () => {
    return (_req, res) => {
        res.status(200).json({ status: 'ok' });
    };
};

export { healthHandler };
