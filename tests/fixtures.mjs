import {DEFAULT_SETTINGS} from '../engine.js';

// Keep the original regression scenarios stable when product defaults change.
export const legacySettings = (patch={}) => ({
  ...structuredClone(DEFAULT_SETTINGS),
  startDate:'2026-10-26',
  slots:['dinner'],
  maxMinutes:35,
  favorites:[],
  avoid:['青椒','茄子','酪梨','照燒','漢堡排'],
  ...patch,
});
