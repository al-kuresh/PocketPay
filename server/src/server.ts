import 'dotenv/config'; // must be first: loads .env before env.ts reads process.env
import { env } from './config/env';
import { createApp } from './app';

createApp().listen(env.PORT, () => {
  console.log(`PocketPay API listening on :${env.PORT}`);
});
