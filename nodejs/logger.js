const winston = require("winston");
const path = require("path");

function createLogger(logFilename, logLocation, logLevel, logFormat) {
  const transports = [
    new winston.transports.Console({
      format: logFormat == "simple" ? winston.format.combine(winston.format.colorize(), winston.format.simple()) : winston.format.json(),
    })
  ];

  // Add file transport when log filename is specified
  if (logFilename != "") {
    transports.push(
      new winston.transports.File({
        filename: path.join(logLocation, logFilename),
      }),
    );
  }

  const logger = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(winston.format.splat(), logFormat == "simple" ? winston.format.simple() : winston.format.json()),
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
