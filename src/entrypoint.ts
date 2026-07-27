import { isInstalled, runInstaller } from './installer.js';

if (!isInstalled()) {
  await runInstaller();
} else {
  await import('./server.js');
}
