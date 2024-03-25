const winston = require("winston");
const path = require("path");

function createLogger(logFilename, logLocation, logLevel, logConsole) {
  const transports = [
    new winston.transports.File({
      filename: path.join(logLocation, logFilename),
    }),
  ];

  // Add console transport in development environment
  if (logConsole == true) {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      })
    );
  }

  const logger = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(winston.format.splat(), winston.format.simple()),
    transports: transports,
  });

  function formatMessage(args) {
    return args
      .map((arg) => {
        if (typeof arg === "object") {
          // Stringify objects
          return JSON.stringify(arg, null, 2); // Pretty print the object
        }
        return arg;
      })
      .join(" ");
  }

  return {
    info: (...messages) => logger.info(formatMessage(messages)),
    error: (...messages) => logger.error(formatMessage(messages)),
    debug: (...messages) => logger.debug(formatMessage(messages)),
  };
}

module.exports = createLogger;
