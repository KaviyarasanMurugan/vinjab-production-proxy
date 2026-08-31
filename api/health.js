export default function handler(req, res) {
    res.status(200).json({
        status: "ok",
        service: "VINJAB API",
        timestamp: new Date().toISOString()
    });
}
