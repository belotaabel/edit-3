import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export type Cell = number | 'star';

type RoundData = {
  id: number;
  status: string;
  startedAt: string;
  selectionEndsAt?: string | null;
  calls: Array<{ number: number; position: number; calledAt: string }>;
  takenCardNumbers: number[];
  pot: string;
  winner?: { telegramId?: number; name?: string; cardNumber: number; payout: string; status: string };
  winners: Array<{ telegramId?: number; name?: string; cardNumber: number; payout: string; status: string }>;
};

type ServerCard = { id?: number; cardNumber: number; grid: Cell[] };

function getApiUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  return configured ? (configured.startsWith('http') ? configured : `https://${configured}`) : '';
}

function telegramHeaders(): Record<string, string> {
  const initData = window.Telegram?.WebApp?.initData;
  return initData ? { 'x-telegram-init-data': initData } : {};
}

export type GameDiagnostic = {
  at: string;
  event: string;
  detail: string;
};

export function useGame(roundId: string | null, pollInterval = 3000) {
  const [connected, setConnected] = useState(false);
  const [round, setRound] = useState<RoundData | null>(null);
  const [cards, setCards] = useState<Array<{ id: number; grid: Cell[] }>>([]);
  const [diagnostics, setDiagnostics] = useState<GameDiagnostic[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const latestSocketState = useRef<{ roundId: number; callCount: number } | null>(null);
  const record = (event: string, detail: string) => {
    setDiagnostics((current) => [{ at: new Date().toISOString(), event, detail }, ...current].slice(0, 40));
  };

  useEffect(() => {
    const socket = io(getApiUrl() || undefined, { path: '/api/socket.io', transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
    socket.on('connect', () => {
      setConnected(true);
      record('socket:connect', `id=${socket.id ?? 'unknown'}`);
    });
    socket.on('connect_error', (error) => record('socket:connect_error', error.message));
    socket.on('disconnect', (reason) => {
      setConnected(false);
      record('socket:disconnect', reason);
    });
    socket.on('game_state', (state: { roundId: number; phase: 'waiting' | 'playing' | 'finished'; currentBall: number | null; calledBalls: number[]; cardsTaken?: number[]; selectionEndsAt?: string | null; winner?: RoundData['winner']; winners?: RoundData['winners']; netPrizePool: number }) => {
      const previousSocketState = latestSocketState.current;
      // The page can still be subscribed to the finished round while the
      // server has already opened the next one. Never let a delayed event
      // from the old round put the finished state back on screen.
      if (previousSocketState && state.roundId < previousSocketState.roundId) return;
      const status = state.phase === 'waiting' ? 'selecting' : state.phase === 'playing' ? 'playing' : 'completed';
      latestSocketState.current = { roundId: state.roundId, callCount: state.calledBalls.length };
      record('socket:game_state', `round=${state.roundId} phase=${state.phase} ball=${state.currentBall ?? '—'} calls=${state.calledBalls.length}`);
      setRound((current) => ({
        id: state.roundId,
        status,
        startedAt: current?.startedAt ?? new Date().toISOString(),
        selectionEndsAt: state.selectionEndsAt ?? current?.selectionEndsAt ?? null,
        calls: state.calledBalls.map((number, position) => ({ number, position, calledAt: new Date().toISOString() })),
        takenCardNumbers: state.cardsTaken ?? current?.takenCardNumbers ?? [],
        pot: String(state.netPrizePool),
        winner: state.winner,
        winners: state.winners ?? (state.winner ? [state.winner] : []),
      }));
    });
    socket.on('cards_taken', (data: { cardIds?: number[] }) => record('socket:cards_taken', `cards=${data.cardIds?.length ?? 0}`));
    socket.on('round_reset', (data: { roundId?: number }) => record('socket:round_reset', `round=${data.roundId ?? 'unknown'}`));
    socket.on('winner', (data: { roundId?: number; telegramId?: number; name?: string; cardNumber?: number; payout?: string; status?: string; winners?: RoundData['winners'] }) => {
      record('socket:winner', `${data.name ?? 'unknown'} card=${data.cardNumber ?? 'unknown'}`);
      const cardNumber = data.cardNumber;
      if (!data.roundId || typeof cardNumber !== 'number' || !Number.isInteger(cardNumber) || !data.payout) return;
      const winner = {
        telegramId: data.telegramId ?? 0,
        name: data.name,
        cardNumber,
        payout: data.payout,
        status: data.status ?? 'completed',
      };
      latestSocketState.current = { roundId: data.roundId, callCount: latestSocketState.current?.callCount ?? 0 };
      setRound((current) => current && current.id === data.roundId
        ? { ...current, status: 'completed', winner, winners: data.winners ?? [winner] }
        : current);
    });
    return () => { socket.disconnect(); };
  }, []);

  const refreshGame = () => setRefreshNonce((value) => value + 1);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const roundQuery = roundId ? `?roundId=${encodeURIComponent(roundId)}` : '';
      const roundResponse = await fetch(`${getApiUrl()}/api/bingo/round${roundQuery}`);
      if (!roundResponse.ok) throw new Error(`Round request failed with ${roundResponse.status}`);
      const nextRound = await roundResponse.json() as RoundData;
      const cardResponse = await fetch(`${getApiUrl()}/api/bingo/cards${roundQuery}`, { headers: telegramHeaders() });
      const cardData = cardResponse.ok ? await cardResponse.json() as { cards: ServerCard[] } : { cards: [] };
      if (cancelled) return;
      setConnected(true);
      const socketState = latestSocketState.current;
      if (socketState && nextRound.id < socketState.roundId) {
        record('api:round', `round=${nextRound.id} stale-skipped (socket is on round ${socketState.roundId})`);
        return;
      }
      const socketHasNewerCalls = socketState?.roundId === nextRound.id && socketState.callCount > nextRound.calls.length;
      record('api:round', `round=${nextRound.id} status=${nextRound.status} calls=${nextRound.calls.length}${socketHasNewerCalls ? ' stale-skipped' : ''}`);
      if (!socketHasNewerCalls) setRound({ ...nextRound, winners: nextRound.winners ?? (nextRound.winner ? [nextRound.winner] : []) });
      setCards(cardData.cards.map((card) => ({ id: card.cardNumber, grid: card.grid })));
    };
    const refresh = () => {
      void load().catch((error: unknown) => {
        if (!cancelled) {
          setConnected(false);
          record('api:error', error instanceof Error ? error.message : 'Round request failed');
        }
      });
    };
    refresh();
    const timer = window.setInterval(refresh, pollInterval);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollInterval, refreshNonce, roundId]);

  const calledBalls = useMemo(() => round?.calls.map((call) => call.number) ?? [], [round]);
  const gameState = useMemo(() => ({
    phase: round?.status === 'selecting' ? 'waiting' : round?.status === 'playing' ? 'playing' : 'finished',
    countdown: round?.selectionEndsAt ? Math.max(0, Math.ceil((new Date(round.selectionEndsAt).getTime() - Date.now()) / 1000)) : 0,
    calledBalls,
    currentBall: calledBalls.at(-1) ?? null,
    playersWithCards: round?.takenCardNumbers.length ?? 0,
    netPrizePool: Number(round?.pot ?? 0),
  }), [calledBalls, round]);

  return { connected, gameState, winner: round?.winner, cards, round, diagnostics, refreshGame };
}
