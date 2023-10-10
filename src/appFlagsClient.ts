import {ConfigurationManager, ConfigurationManagerOptions} from "./configurationManager";
import {Logger, LoggerOptions} from "./utils/logger";
import {Bucketing} from "./bucketing";
import {Flag, User} from "@appflags/common";
import {fromFlagProto, toUserProto} from "./utils/protobufConverters";
import {EventEmitter} from "eventemitter3";

interface ClientInitializationOptions {
    loggerOptions?: LoggerOptions
    configurationOptions?: ConfigurationManagerOptions
    _edgeUrlOverride?: string,
}

const FLAGS_CHANGED_EVENT = "flags-changed";

let clientCount = 0;

export class AppFlagsClient {
    private readonly logger: Logger;
    private readonly configurationManager: ConfigurationManager;
    private readonly bucketing: Bucketing;
    private readonly eventBus;
    private readonly initializedPromise: Promise<void>;

    /**
     * Create an AppFlags client.
     *
     * @param sdkKey - The SDK key to initialize the client. This SDK pertains to a particular environment and can be found in the AppFlags dashboard.
     * @param options - Optional parameters for initializing the client. Not needed for most cases.
     */
    constructor(sdkKey: string, options: ClientInitializationOptions = {}) {
        const edgeUrl = options._edgeUrlOverride || "https://edge.appflags.net";

        this.logger = new Logger(options.loggerOptions || {});
        this.configurationManager = new ConfigurationManager(this.logger, edgeUrl, sdkKey, this.handleConfigurationChanged, options.configurationOptions || {});
        this.bucketing = new Bucketing();
        this.eventBus = new EventEmitter();

        this.initializedPromise = this.initialize()
        .then(() => {
            this.logger.info("Initialized AppFlags client");
        }).catch(err => {
            this.logger.error("Unable to initialize the AppFlags client.", err);
            throw Error("Unable to initialize the AppFlags client.");
        })

        clientCount++;
        if (clientCount > 1) {
            this.logger.warn(`You have initialized multiple AppFlags clients (count: ${clientCount}). You should only initialize a single client unless you absolutely need multiple clients (e.g. using multiple AppFlags projects).`);
        }

        process.on('exit', () => {
            this.close()
        })
    }

    private async initialize() {
        await this.configurationManager.initialize();
        await this.bucketing.instantiate();
        this.bucketing.setConfiguration(this.configurationManager.getConfiguration());
    }

    /**
     * Returns a promise that resolves when the AppFlags client is fully initialized and ready for use.
     *
     * @returns A promise that resolves when the client is initialized
     */
    onInitialized(): Promise<void> {
        return this.initializedPromise;
    }

    private handleConfigurationChanged = () => {
        this.bucketing.setConfiguration(this.configurationManager.getConfiguration());
        this.eventBus.emit(FLAGS_CHANGED_EVENT);
    }

    /**
     * Invokes a callback when your flags have changed
     *
     * @param callback - A function to be called when your flags change
     */
    onFlagsChanged(callback: () => void) {
        this.eventBus.on(FLAGS_CHANGED_EVENT, callback);
    }

    /**
     * Computes and returns all flags for a  user
     *
     * @param user -  The user to use when computing flags.
     * @returns An array of Flag objects computed for the provided user.
     */
    getAllFlags(user: User): Flag[] {
        const userProto = toUserProto(user);
        const bucketingResults = this.bucketing.bucket(userProto);
        const flags = bucketingResults.flags.map(fromFlagProto);

        this.logger.debug(`Determined flags for user [key: ${user.key}], flags:`, flags);

        return flags;
    }

    /**
     * Computes and returns a single flag for user
     *
     * @param user - The user to use when computing flags.
     * @param key - The key of the flag to return
     * @returns The Flag computed for the provided user, or undefined if no such Flag exists.
     */
    getFlag(user: User, key: string): Flag|undefined {
        const userProto = toUserProto(user);
        const bucketingResults = this.bucketing.bucketOneFlag(userProto, key);
        const flags = bucketingResults.flags.map(fromFlagProto);
        return flags.find(flag => flag.key === key);
    }

    /**
     * Closes the AppFlags client. This will shut down the client and flush any remaining events.
     * If not called, this is automatically invoked on process exit.
     */
    async close(): Promise<void> {
        this.configurationManager.close();
        clientCount--;
    }

}