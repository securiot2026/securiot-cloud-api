// Nest ConfigModule loads the local env file when the app module is imported, but it never
// overrides a variable that already exists in process.env. Assigning blanks here (setupFiles run
// before any spec imports the app) guarantees an e2e run can never pick up the owner's real Resend
// key, admin address or dev-log switch, so no test can send a real email.
process.env.RESEND_API_KEY = '';
process.env.ADMIN_EMAIL = '';
process.env.MAIL_DEV_LOG = '';
// The billing simulator waits 600 to 1200 ms per charge by default, no test should.
process.env.BILLING_SIMULATED_LATENCY_MS = '0';
