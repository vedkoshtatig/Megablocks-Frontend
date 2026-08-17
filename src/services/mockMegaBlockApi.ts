import type {
  CashOutMegaBlockResponse,
  DropMegaBlockResponse,
  LaunchRequest,
  LaunchResponse,
  MegaBlockBet,
  MegaBlockBetsResponse,
  MegaBlockClient,
  MegaBlockDifficulty,
  MegaBlockSettings,
  PlaceMegaBlockBetRequest,
  PlaceMegaBlockBetResponse,
  UnfinishedMegaBlockBetResponse
} from './megaBlockTypes';

const MOCK_SETTINGS: MegaBlockSettings = {
  defaultDifficulty: 'easy',
  difficulties: {
    easy: { maxFloor: 24 },
    medium: { maxFloor: 22 },
    hard: { maxFloor: 20 },
    hardcore: { maxFloor: 15 }
  },
  maxBet: 100,
  maxProfit: 1000,
  minBet: 0.1
};

type MockRound = MegaBlockBet & {
  crashFloor: number;
};

export class MockMegaBlockClient implements MegaBlockClient {
  private balance = 1000;
  private betCounter = 41;
  private history: MegaBlockBet[] = [];
  private activeRound: MockRound | null = null;
  private currency = 'SC';

  async launch(_request: LaunchRequest): Promise<LaunchResponse> {
    await delay(180);
    return {
      currency: this.currency,
      gameKey: 'mega-block',
      token: 'mock-mega-block-token'
    };
  }

  async getSettings(): Promise<MegaBlockSettings> {
    await delay(120);
    return MOCK_SETTINGS;
  }

  async getUnfinishedBet(): Promise<UnfinishedMegaBlockBetResponse> {
    await delay(120);
    return {
      hasUnfinishedBet: Boolean(this.activeRound),
      unfinishedBet: this.activeRound ? withoutOpenCrashFloor(this.activeRound) : null
    };
  }

  async placeBet(request: PlaceMegaBlockBetRequest): Promise<PlaceMegaBlockBetResponse> {
    await delay(220);

    if (this.activeRound) {
      throw new Error('OpenBetExistsErrorType');
    }

    const maxFloor = MOCK_SETTINGS.difficulties[request.difficulty].maxFloor;
    const betAmount = clampCurrency(request.amount);

    if (betAmount < MOCK_SETTINGS.minBet || betAmount > MOCK_SETTINGS.maxBet) {
      throw new Error('BetAmountOutOfRangeErrorType');
    }

    if (betAmount > this.balance) {
      throw new Error('InsufficientBalanceErrorType');
    }

    this.balance = clampCurrency(this.balance - betAmount);
    this.betCounter += 1;
    const id = String(this.betCounter);
    const nonce = this.betCounter - 39;
    const crashFloor = chooseCrashFloor(maxFloor, request.difficulty);

    this.activeRound = {
      betAmount,
      clientSeed: request.clientSeed,
      crashFloor,
      currency: this.currency,
      currentFloorCount: 0,
      gameDifficulty: request.difficulty,
      id,
      maxFloor,
      nonce,
      payoutMultiplier: 1,
      result: null,
      roundId: crypto.randomUUID?.() ?? `mock-round-${id}`,
      serverSeedHash: `mock-server-seed-hash-${nonce}`,
      winningAmount: 0
    };

    return {
      betAmount,
      betId: id,
      clientSeed: request.clientSeed,
      currency: this.currency,
      currentFloorCount: 0,
      difficulty: request.difficulty,
      maxFloor,
      nonce,
      serverSeedHash: this.activeRound.serverSeedHash
    };
  }

  async dropBlock(betId: string): Promise<DropMegaBlockResponse> {
    await delay(260);
    const round = this.getActiveRound(betId);
    const attemptedFloor = round.currentFloorCount + 1;

    if (attemptedFloor === round.crashFloor) {
      round.result = 'lost';
      round.winningAmount = 0;
      round.payoutMultiplier = 0;
      this.completeRound(round);

      return {
        attemptedFloor,
        betId,
        clientSeed: round.clientSeed,
        completedFloorCount: round.currentFloorCount,
        crashFloor: round.crashFloor,
        maxFloor: round.maxFloor,
        nonce: round.nonce,
        payoutMultiplier: 0,
        result: 'lost',
        serverSeedHash: round.serverSeedHash,
        winningAmount: 0
      };
    }

    round.currentFloorCount = attemptedFloor;
    round.payoutMultiplier = multiplierForFloor(round.currentFloorCount, round.maxFloor);

    if (round.currentFloorCount >= round.maxFloor) {
      const winningAmount = clampCurrency(Number(round.betAmount) * Number(round.payoutMultiplier));
      round.result = 'won';
      round.winningAmount = winningAmount;
      this.balance = clampCurrency(this.balance + winningAmount);
      this.completeRound(round);

      return {
        balance: this.balance,
        betId,
        clientSeed: round.clientSeed,
        completedFloorCount: round.currentFloorCount,
        crashFloor: round.maxFloor + 1,
        maxFloor: round.maxFloor,
        nonce: round.nonce,
        payoutMultiplier: Number(round.payoutMultiplier),
        result: 'won',
        serverSeedHash: round.serverSeedHash,
        winningAmount
      };
    }

    return {
      betId,
      completedFloorCount: round.currentFloorCount,
      maxFloor: round.maxFloor,
      payoutMultiplier: Number(round.payoutMultiplier),
      result: null
    };
  }

  async cashOut(betId: string): Promise<CashOutMegaBlockResponse> {
    await delay(240);
    const round = this.getActiveRound(betId);

    if (round.currentFloorCount === 0) {
      throw new Error('MegaBlockNoFloorsCompletedErrorType');
    }

    const winningAmount = clampCurrency(Number(round.betAmount) * Number(round.payoutMultiplier));
    round.result = 'won';
    round.winningAmount = winningAmount;
    this.balance = clampCurrency(this.balance + winningAmount);
    this.completeRound(round);

    return {
      balance: this.balance,
      betAmount: round.betAmount,
      betId,
      clientSeed: round.clientSeed,
      completedFloorCount: round.currentFloorCount,
      crashFloor: round.crashFloor,
      currency: round.currency,
      maxFloor: round.maxFloor,
      nonce: round.nonce,
      payoutMultiplier: Number(round.payoutMultiplier),
      result: 'won',
      serverSeedHash: round.serverSeedHash,
      winningAmount
    };
  }

  async getBets(page = 1, perPage = 10): Promise<MegaBlockBetsResponse> {
    await delay(120);
    const offset = (page - 1) * perPage;
    const data = this.history.slice(offset, offset + perPage);

    return {
      currentPage: page,
      data,
      totalCount: this.history.length,
      totalPages: Math.max(Math.ceil(this.history.length / perPage), 1)
    };
  }

  async getBetById(betId: string): Promise<MegaBlockBet & { seedRevealed?: boolean }> {
    await delay(100);
    const bet = this.history.find(({ id }) => id === betId) ?? this.activeRound;

    if (!bet) {
      throw new Error('NoOpenBetErrorType');
    }

    return {
      ...bet,
      seedRevealed: false
    };
  }

  private getActiveRound(betId: string): MockRound {
    if (!this.activeRound || this.activeRound.id !== betId) {
      throw new Error('NoOpenBetErrorType');
    }

    return this.activeRound;
  }

  private completeRound(round: MockRound): void {
    this.history.unshift({ ...round });
    this.activeRound = null;
  }
}

function chooseCrashFloor(maxFloor: number, difficulty: MegaBlockDifficulty): number {
  const riskByDifficulty: Record<MegaBlockDifficulty, number> = {
    easy: 0.18,
    medium: 0.23,
    hard: 0.3,
    hardcore: 0.38
  };

  for (let floor = 1; floor <= maxFloor; floor += 1) {
    if (Math.random() < riskByDifficulty[difficulty]) {
      return floor;
    }
  }

  return maxFloor + 1;
}

function multiplierForFloor(floor: number, maxFloor: number): number {
  const progress = floor / maxFloor;
  return Number((1 + progress * progress * 23.25).toFixed(6));
}

function withoutOpenCrashFloor(round: MockRound): MegaBlockBet {
  const { crashFloor: _crashFloor, ...safeRound } = round;
  return {
    ...safeRound,
    crashFloor: null
  };
}

function clampCurrency(value: number): number {
  return Number(value.toFixed(2));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
