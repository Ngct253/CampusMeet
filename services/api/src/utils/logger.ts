export const logger = {
  info(message: string, context: Record<string, unknown> = {}) {
    console.info(JSON.stringify({ level: 'info', message, ...context }));
  },
  error(message: string, context: Record<string, unknown> = {}) {
    console.error(JSON.stringify({ level: 'error', message, ...context }));
  },
};
