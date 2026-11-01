import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Every page reads the database at request time; nothing to cache between deploys.
export default defineCloudflareConfig();
