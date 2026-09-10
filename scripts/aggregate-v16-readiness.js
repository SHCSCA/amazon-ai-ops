// Compatibility entry point; all readiness decisions use the same verifier.
const { main } = require('./verify-v16-readiness-aggregation.js');
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
