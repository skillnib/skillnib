import { resolve } from 'node:path';
import { UsageError, intFlag } from './args.js';
import { createUiApp } from './ui/server.js';

// `nib ui`: a local web page over the same commands. It listens on 127.0.0.1 only and runs until Ctrl+C.
export async function cmdUi(args, io, _storeDir, deps) {
  if (args.positionals.length) throw new UsageError('ui takes no arguments');
  if (args.flags['--store'] !== undefined) throw new UsageError('ui always uses <project>/.nib; --store is not accepted (use --project DIR to choose the project)');
  const project = resolve(io.cwd, args.flags['--project'] ?? '.'), port = intFlag(args.flags, '--port', 4317, 0, 65535);
  const app = createUiApp({ project, env: io.env, fetch: io.fetch, nibPath: io.nibPath });
  const actual = await app.listen(port);
  io.stdout.write(`SkillNib dashboard for ${project}\nhttp://127.0.0.1:${actual}/  (this computer only; Ctrl+C to stop)\n`);
  deps.onListening?.(app);
  const stop = () => app.server.close();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  await new Promise(done => app.server.once('close', done));
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
  return 0;
}
