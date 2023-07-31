
export enum AppFlagsLogLevel {
    debug = "debug",
    info = "info",
    warn = "warn",
    error = "error"
}

const prefix = "[AppFlags]: ";

export interface LoggerOptions {
    logLevel?: AppFlagsLogLevel
}

export class Logger {
    private readonly logLevel;

    constructor(options: LoggerOptions ) {
        this.logLevel = AppFlagsLogLevel.info;
        if (options.logLevel !== undefined) {
            this.logLevel = options.logLevel;
            this.info(`Log level set to [${this.logLevel.toString()}]`)
        }
    }

    debug(msg: string, ...optionalParams: any[]) {
        if (this.logLevel > AppFlagsLogLevel.debug)
            return;
        console.info(prefix + msg, ...optionalParams);
    }

    info(msg: string, ...optionalParams: any[]) {
        if (this.logLevel > AppFlagsLogLevel.info)
            return;
        console.info(Logger.colorize(prefix + msg, Logger.BLUE), ...optionalParams);
    }

    warn(msg: string, ...optionalParams: any[]) {
        if (this.logLevel > AppFlagsLogLevel.warn)
            return;
        console.warn(Logger.colorize(prefix + msg, Logger.YELLOW), ...optionalParams);
    }

    error(msg: string, ...optionalParams: any[]) {
        console.error(Logger.colorize(prefix + msg, Logger.RED), ...optionalParams);
    }

    private static RED = "91";
    private static YELLOW = "33";
    private static BLUE = "34";
    private static colorize(msg: string, color: string) {
        return `\x1b[${color}m${msg}\x1b[0m`;
    }
}