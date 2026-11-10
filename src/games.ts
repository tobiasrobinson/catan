import type { GameEntry } from './net/protocol';
import { catanGame } from './engine/online';
import { CatanView } from './ui/GameView';
import { carcGame } from './carc/online';
import { CarcView } from './carc/View';

export const GAMES: Record<string, GameEntry> = {
  catan: { def: catanGame, View: CatanView, saveKey: 'catan-save-v1' },
  carcassonne: { def: carcGame, View: CarcView, saveKey: 'carc-save-v1' },
};
