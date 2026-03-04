// Set env vars before app/routes load (they read process.env at import time)
process.env.FUTURO_ADMIN_KEY = process.env.FUTURO_ADMIN_KEY || 'test-admin-key';
process.env.REQUIRE_API_KEY = 'false'; // Allow unauthenticated API access in integration tests
