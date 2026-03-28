interface Config {
  name: string
  version: number
}

export function useConfig(): Config
export function useConfig<T>(selector: (config: Config) => T): T
export function useConfig<T>(selector?: (config: Config) => T) {
  const config: Config = { name: 'app', version: 1 }
  return selector ? selector(config) : config
}
