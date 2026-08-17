import type {
  CashOutMegaBlockResponse,
  DropMegaBlockResponse,
  LaunchRequest,
  LaunchResponse,
  MegaBlockBet,
  MegaBlockBetsResponse,
  MegaBlockClient,
  MegaBlockSettings,
  PlaceMegaBlockBetRequest,
  PlaceMegaBlockBetResponse,
  UnfinishedMegaBlockBetResponse
} from './megaBlockTypes';

type ApiEnvelope<T> = {
  data: T;
  errors?: Array<{ errorCode?: number; fields?: Record<string, unknown>; message?: string }>;
};

export class MegaBlockApiClient implements MegaBlockClient {
  private token: string | null = null;
  private readonly originalGamesApiUrl: string;

  constructor(baseUrl: string) {
    this.originalGamesApiUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/original-games`;
  }

  async launch(request: LaunchRequest): Promise<LaunchResponse> {
    const response = await this.post<LaunchResponse>('/launch', request, false);
    this.token = response.token;
    return response;
  }

  getSettings(): Promise<MegaBlockSettings> {
    return this.get('/mega-block/settings');
  }

  getUnfinishedBet(): Promise<UnfinishedMegaBlockBetResponse> {
    return this.get('/mega-block/unfinished-bet');
  }

  placeBet(request: PlaceMegaBlockBetRequest): Promise<PlaceMegaBlockBetResponse> {
    return this.post('/mega-block/place-bet', request);
  }

  dropBlock(betId: string): Promise<DropMegaBlockResponse> {
    return this.post('/mega-block/drop-block', { betId: String(betId) });
  }

  cashOut(betId: string): Promise<CashOutMegaBlockResponse> {
    return this.post('/mega-block/cash-out', { betId: String(betId) });
  }

  getBets(page = 1, perPage = 10): Promise<MegaBlockBetsResponse> {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    return this.get(`/mega-block/bets?${params.toString()}`);
  }

  getBetById(betId: string): Promise<MegaBlockBet & { seedRevealed?: boolean }> {
    return this.get(`/mega-block/bets/${betId}`);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async post<T>(path: string, body: unknown, includeAuth = true): Promise<T> {
    return this.request<T>(
      path,
      {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      },
      includeAuth
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    includeAuth = true
  ): Promise<T> {
    const headers = new Headers(init.headers);

    if (includeAuth) {
      if (!this.token) {
        throw new Error('MegaBlock session has not launched yet.');
      }

      headers.set('Authorization', `AccessToken=${this.token}`);
    }

    const response = await fetch(`${this.originalGamesApiUrl}${path}`, {
      ...init,
      headers
    });

    let envelope: ApiEnvelope<T>;

    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
      throw new Error(`MegaBlock API returned ${response.status} without JSON.`);
    }

    if (!response.ok || (envelope.errors?.length ?? 0) > 0) {
      const errorCode = envelope.errors?.[0]?.errorCode;
      throw new Error(errorCode ? `MegaBlock API error ${errorCode}` : 'MegaBlock API request failed.');
    }

    return envelope.data;
  }
}
