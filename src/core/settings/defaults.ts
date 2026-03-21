import type { ISvpSettings } from './types';

export const SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS: ISvpSettings = {
  version: SETTINGS_VERSION,
  modules: {},
  errors: {},
};
