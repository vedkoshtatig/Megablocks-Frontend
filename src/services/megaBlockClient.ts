import { appEnv } from '../config/env';
import { MegaBlockApiClient } from './megaBlockApi';
import { MockMegaBlockClient } from './mockMegaBlockApi';
import type { MegaBlockClient } from './megaBlockTypes';

export function createMegaBlockClient(): MegaBlockClient {
  return appEnv.useMockData
    ? new MockMegaBlockClient()
    : new MegaBlockApiClient(appEnv.apiBaseUrl);
}

export function getMegaBlockDataMode(): 'mock' | 'api' {
  return appEnv.useMockData ? 'mock' : 'api';
}
