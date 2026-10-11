// Runs the exported main() of a TypeScript script through Vite's module loader, so the script can
// import the app's source the same way the app does (extensionless imports, TypeScript).
//   node scripts/run-ts.mjs scripts/build-example.ts
import { createServer } from 'vite';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-ts.mjs <script.ts>');
  process.exit(2);
}
const server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true } });
try {
  const mod = await server.ssrLoadModule(`/${file.replace(/^\.?\//, '')}`);
  await mod.main();
} finally {
  await server.close();
}
