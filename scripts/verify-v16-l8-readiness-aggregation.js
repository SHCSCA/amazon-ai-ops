// Recompute current readiness from source, required runners and traceability.
const { main } = require('./verify-v16-readiness-aggregation.js');
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = require('./verify-v16-readiness-aggregation.js');
