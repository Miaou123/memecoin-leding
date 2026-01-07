const { spawn } = require('child_process');
const path = require('path');

// Start local validator if needed
console.log('Starting test validator...');
const validator = spawn('solana-test-validator', ['--no-bpf-jit'], {
  stdio: 'pipe',
  detached: false
});

// Wait for validator to start
setTimeout(() => {
  console.log('Running tests...');
  
  // Run the test file
  const test = spawn('npx', ['ts-node', '--transpile-only', 'tests/memecoin-lending.ts'], {
    stdio: 'inherit',
    env: { ...process.env }
  });

  test.on('close', (code) => {
    console.log(`Tests finished with code ${code}`);
    validator.kill();
    process.exit(code);
  });
}, 5000);

validator.on('error', (err) => {
  console.error('Failed to start validator:', err);
  process.exit(1);
});