import { createApp } from './app.factory';
import { loadApiConfig } from './config/api-config';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const app = await createApp(config);
  await app.listen(config.port);
  console.log(`une-api listening on :${config.port} (AUTH_MODE=${config.authMode})`);
}

void bootstrap();
