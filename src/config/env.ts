type RuntimeEnv = Record<string, string | boolean | undefined>;

const env = import.meta.env as RuntimeEnv;

function readEnv(name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = readEnv(name);

  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const appEnv = {
  apiBaseUrl:
    readEnv('VITE_BASE_URL') ??
    readEnv('VITE_ORIGINAL_GAMES_BASE_URL') ??
    readEnv('NEXT_PUBLIC_BASE_URL') ??
    'http://localhost:9004',
  useMockData: readBooleanEnv('VITE_USE_MOCK_DATA', false)
};
