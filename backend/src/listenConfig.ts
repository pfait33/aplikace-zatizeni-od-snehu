export function listenConfig(env: Record<string, string | undefined>) {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return { host: env.HOST ?? '0.0.0.0', port };
}
