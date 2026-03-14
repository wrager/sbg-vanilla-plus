import type { ISvpSettings } from './types';

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: ISvpSettings = {
  version: SETTINGS_VERSION,
  modules: {},
};
