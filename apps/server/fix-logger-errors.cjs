const fs = require('fs');
const path = require('path');

// Files with logger errors
const files = [
  'src/jobs/lp-monitor.job.ts',
  'src/routes/admin/whitelist.ts', 
  'src/routes/prices.ts',
  'src/routes/tokens.ts',
  'src/services/price.service.ts',
];

// Pattern to match logger.error calls with unknown error parameter
const errorPattern = /logger\.(error|warn|info|debug)\((.*?),\s*error\)/g;

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  
  content = content.replace(errorPattern, (match, level, msgPart) => {
    changed = true;
    return `logger.${level}(${msgPart}, { error: error instanceof Error ? error.message : String(error) })`;
  });
  
  // Also fix patterns like sanitizeForLogging(error.message)
  const sanitizePattern = /logger\.(error|warn|info|debug)\((.*?),\s*{\s*error:\s*sanitizeForLogging\(error\.message\)\s*}/g;
  content = content.replace(sanitizePattern, (match, level, msgPart) => {
    changed = true;
    return `logger.${level}(${msgPart}, { error: error instanceof Error ? sanitizeForLogging(error.message) : 'Unknown error' }`;
  });
  
  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log(`Updated: ${file}`);
  }
});

console.log('Done fixing logger errors');