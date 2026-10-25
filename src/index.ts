import { start } from './app.js';

export { app, prisma, buildApp, start } from './app.js';

if (process.env.NODE_ENV !== 'test') {
  start();
}
