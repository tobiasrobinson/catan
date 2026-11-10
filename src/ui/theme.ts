import { Resource } from '../engine/types';

export const TERRAIN_COLORS: Record<string, string> = {
  wood: '#2e7d32',
  brick: '#c0592b',
  sheep: '#9ccc65',
  wheat: '#f2c94c',
  ore: '#8e9aa6',
  desert: '#e3cf9a',
};

export const RES_LABEL: Record<Resource, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
};

export const DEV_LABEL = {
  knight: 'Knight',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
  victoryPoint: 'Victory Point',
} as const;

export const DEV_DESC: Record<keyof typeof DEV_LABEL, string> = {
  knight: 'Move the robber and steal 1 resource from a player next to the new tile. Playing the most Knights (3+) earns Largest Army (+2 VP). Can be played before rolling.',
  roadBuilding: 'Place 2 roads for free.',
  yearOfPlenty: 'Take any 2 resources of your choice from the bank.',
  monopoly: 'Name a resource; every other player must give you all of that resource they hold.',
  victoryPoint: 'Worth 1 hidden victory point. Kept secret until it wins you the game.',
};
