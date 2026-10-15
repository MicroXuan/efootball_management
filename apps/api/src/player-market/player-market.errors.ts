import { LeagueError } from '../leagues/league.errors.js';

export class PlayerMarketError extends LeagueError {}

export const playerMarketError = (code: string, message: string, status = 409, details?: Record<string, unknown>) =>
  new PlayerMarketError(code, message, status, details);
