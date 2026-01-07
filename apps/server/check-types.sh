#!/bin/bash
cd "$(dirname "$0")"
exec node ../../node_modules/typescript/lib/tsc.js --noEmit