#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { main } from '../src/main.js';

process.exitCode = await main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin.isTTY ? null : process.stdin, cwd: process.cwd(), env: process.env, fetch: globalThis.fetch, nibPath: realpathSync(process.argv[1]) });
process.stdin.destroy();
