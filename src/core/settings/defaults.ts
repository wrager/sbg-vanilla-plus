import type { ISvpSettings } from './types';

export const SETTINGS_VERSION = 5;

export const DEFAULT_SETTINGS: ISvpSettings = {
  version: SETTINGS_VERSION,
  modules: {},
  errors: {},
};
