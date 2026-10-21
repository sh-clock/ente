// Dormant in the fork: clients pass their own origin (the local backend
// on desktop/web). Kept as the wasm/frb default constructor fallback.
pub const PRODUCTION_API_ORIGIN: &str = "https://api.ente.com";

// `origin` must be an origin. Preserving path prefixes is a best-effort
// convenience for self-hosters.
pub(crate) fn api_url(origin: &str, path: &str) -> String {
    format!(
        "{}/{}",
        origin.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}
