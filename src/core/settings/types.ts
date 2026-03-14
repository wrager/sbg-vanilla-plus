export interface ISvpSettings {
  version: number;
  modules: Record<string, boolean>;
  errors: Record<string, string>;
}
