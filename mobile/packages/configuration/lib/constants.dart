// SELF_HOSTING: this standalone fork has no ente account backend. The default
// API origin is an unroutable placeholder (fail fast, nothing leaves the
// device). A self-hosted or future protocol backend is selected either at
// build time via `String.fromEnvironment("endpoint")` (dart-define:
// endpoint=https://your-server) or at runtime via setHttpEndpoint() — the
// stored preference always wins over this default. Mirrors the web seam
// NEXT_PUBLIC_PHOTOS_API_ENDPOINT.
const kDefaultProductionEndpoint = 'https://127.0.0.1:1';
// Kept distinct so legacy api.ente.io values stored by old installs normalize
// to the placeholder above instead of an ente origin.
const kLegacyProductionEndpoint = 'https://api.ente.io';

// 256 bit key maps to 24 words
// https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki#Generating_the_mnemonic
const mnemonicKeyWordCount = 24;
