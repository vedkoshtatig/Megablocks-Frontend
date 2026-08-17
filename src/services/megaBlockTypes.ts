export type MegaBlockDifficulty = 'easy' | 'medium' | 'hard' | 'hardcore';
export type MegaBlockResult = 'won' | 'lost' | null;

export type LaunchRequest = {
  casinoSessionId: string;
  device?: 'DESKTOP' | 'MOBILE';
  gameKey: 'mega-block';
  lang?: string;
};

export type LaunchResponse = {
  currency: string;
  gameKey: 'mega-block';
  token: string;
};

export type MegaBlockSettings = {
  defaultDifficulty: MegaBlockDifficulty;
  difficulties: Record<MegaBlockDifficulty, { maxFloor: number }>;
  maxBet: number;
  maxProfit: number;
  minBet: number;
};

export type MegaBlockBet = {
  betAmount: number | string;
  clientSeed: string;
  crashFloor?: number | null;
  currency: string;
  currentFloorCount: number;
  gameDifficulty: MegaBlockDifficulty;
  id: string;
  maxFloor: number;
  nonce: number;
  payoutMultiplier: number | string;
  result: MegaBlockResult;
  roundId?: string;
  serverSeedHash: string;
  winningAmount: number | string;
};

export type UnfinishedMegaBlockBetResponse = {
  hasUnfinishedBet: boolean;
  unfinishedBet: MegaBlockBet | null;
};

export type PlaceMegaBlockBetRequest = {
  amount: number;
  clientSeed: string;
  difficulty: MegaBlockDifficulty;
};

export type PlaceMegaBlockBetResponse = {
  betAmount: number;
  betId: string;
  clientSeed: string;
  currency: string;
  currentFloorCount: number;
  difficulty: MegaBlockDifficulty;
  maxFloor: number;
  nonce: number;
  serverSeedHash: string;
};

export type DropMegaBlockResponse = {
  balance?: number;
  betId: string;
  clientSeed?: string;
  completedFloorCount: number;
  crashFloor?: number;
  maxFloor: number;
  nonce?: number;
  payoutMultiplier: number;
  result: MegaBlockResult;
  serverSeedHash?: string;
  attemptedFloor?: number;
  winningAmount?: number;
};

export type CashOutMegaBlockResponse = {
  balance?: number;
  betAmount: number | string;
  betId: string;
  clientSeed: string;
  completedFloorCount: number;
  crashFloor: number;
  currency: string;
  maxFloor: number;
  nonce: number;
  payoutMultiplier: number;
  result: 'won';
  serverSeedHash: string;
  winningAmount: number;
};

export type MegaBlockBetsResponse = {
  currentPage: number;
  data: MegaBlockBet[];
  totalCount: number;
  totalPages: number;
};

export interface MegaBlockClient {
  cashOut(betId: string): Promise<CashOutMegaBlockResponse>;
  dropBlock(betId: string): Promise<DropMegaBlockResponse>;
  getBetById(betId: string): Promise<MegaBlockBet & { seedRevealed?: boolean }>;
  getBets(page?: number, perPage?: number): Promise<MegaBlockBetsResponse>;
  getSettings(): Promise<MegaBlockSettings>;
  getUnfinishedBet(): Promise<UnfinishedMegaBlockBetResponse>;
  launch(request: LaunchRequest): Promise<LaunchResponse>;
  placeBet(request: PlaceMegaBlockBetRequest): Promise<PlaceMegaBlockBetResponse>;
}
