class Logger {
    constructor(userId = "CTABot", guildId = "N/A") {
        this.userId = userId;
        this.guildId = guildId;
    }

    _getTimestamp() {
        return new Date().toISOString();
    }

    _log(message, level, stackTrace = "") {
        let logMessage = `[${this._getTimestamp()}] [${level}] [User: ${this.userId}] [Guild: ${this.guildId}] ${message}`;
        if (stackTrace) {
            logMessage += `\nStack Trace:\n${stackTrace}`;
        }
        console.log(logMessage);
    }

    info(message, stackTrace = "") {
        this._log(message, "INFO", stackTrace);
    }

    error(message, stackTrace = "") {
        this._log(message, "ERROR", stackTrace);
    }

    critical(message, stackTrace = "") {
        this._log(message, "CRITICAL", stackTrace);
    }
}

export { Logger };