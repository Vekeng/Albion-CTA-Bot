import { createLogger, format, transports } from 'winston';

// Custom logger with dynamic context support
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, guildId, userId }) => {
      let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
      if (guildId) log += ` | Guild: ${guildId}`;
      if (userId) log += ` | User: ${userId}`;
      return log;
    })
  ),
  transports: [
    new transports.Console({
      forceConsole: true, // Force console output
    }),
    //new transports.File({ filename: 'bot.log' }),
  ],
});

// Extend logger to allow setting dynamic context
logger.context = {}; // Store global context

logger.setContext = (key, value) => {
  logger.context[key] = value;
};

logger.clearContext = () => {
  logger.context = {};
};

logger.logWithContext = (level, message, meta = {}) => {
  const fullMeta = { ...logger.context, ...meta };
  logger.log(level, message, fullMeta);
};

export { logger };