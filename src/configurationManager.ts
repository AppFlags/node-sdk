import {appflags} from "@appflags/protobuf-types-typescript";
import {Logger} from "./utils/logger";
import fetch from 'node-fetch';
import * as Ably from "ably";
import {ConfigurationNotification} from "@appflags/common";
import {getPlatformData} from "./utils/platformUtil";
import {Buffer} from "node:buffer";

export interface ConfigurationManagerOptions {
    pollingPeriodMs?: number;
}

const ONE_MIN_MS = 60000;
const TEN_MIN_MS = ONE_MIN_MS * 10;

export class ConfigurationManager {
    private readonly logger: Logger;
    private readonly edgeUrl: string;
    private readonly sdkKey: string;
    private readonly configurationChangedCallback: () => void;
    private configuration: appflags.Configuration|null;
    private readonly pollingPeriodMs: number;
    private pollingTimer: NodeJS.Timer|null;
    private readonly platformData: appflags.PlatformData;

    constructor(logger: Logger, baseUrl: string, sdkKey: string, configurationChangedCallback: () => void, options: ConfigurationManagerOptions) {
        this.logger = logger;
        this.edgeUrl = baseUrl;
        this.sdkKey = sdkKey;
        this.configurationChangedCallback = configurationChangedCallback;
        this.configuration = null;

        this.pollingPeriodMs = TEN_MIN_MS;
        if (options.pollingPeriodMs !== undefined) {
            this.pollingPeriodMs = Math.max(ONE_MIN_MS, options.pollingPeriodMs);
            this.logger.info(`Configuration polling period set to ${this.pollingPeriodMs} ms`);
        }

        this.pollingTimer = null;
        this.platformData = getPlatformData();
    }

    getConfiguration(): appflags.Configuration {
        if (!this.configuration) {
            // TODO: add better logging here to explain to user how to wait for initialization
            this.logger.error("Cannot use configuration before the client has been initialized.");
            throw Error("ConfigurationManager is not initialized yet");
        }
        return this.configuration;
    }

    async initialize(): Promise<void> {
        this.configuration = await this.loadConfiguration(appflags.ConfigurationLoadType.INITIAL_LOAD);

        if (!this.configuration.environmentId) {
            this.logger.error("Unable to subscribe to realtime configuration changes because configuration is missing `environmentId` property");
        } else {
            this.listenForConfigurationUpdates(this.configuration.environmentId);
        }

        this.pollForConfigurationUpdates();
    }

    // Gets configuration from the server
    private async loadConfiguration(loadType: appflags.ConfigurationLoadType, getUpdateAt?: number) : Promise<appflags.Configuration> {
        let url = this.edgeUrl + "/configuration/v1/config";
        if (getUpdateAt) {
            url += `?getUpdateAt=${getUpdateAt}`;
        }

        const metadata: appflags.ConfigurationLoadMetadata = appflags.ConfigurationLoadMetadata.create();
        metadata.platformData = this.platformData;
        metadata.loadType = loadType;
        const encodedMetadata = Buffer.from(appflags.ConfigurationLoadMetadata.encode(metadata).finish()).toString("base64");

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer: " + this.sdkKey
            },
            body: JSON.stringify({
                metadata: encodedMetadata
            })
        });
        if (response.status === 403) {
            throw Error("Invalid SDK key");
        }
        if (response.status !== 200) {
            throw Error(`Error loading configuration from edge server, http status: ${response.status}`)
        }

        const json = await response.json() as {configuration: string};
        const buffer = Buffer.from(json.configuration, "base64");
        const configuration =  appflags.Configuration.decode(buffer);

        this.logger.debug(`Loaded configuration published at ${configuration.published?.toLocaleString()}, contains ${configuration.flags.length} flags.`);

        return configuration;
    }

    private updateConfigurationIfNewer(newConfiguration: appflags.Configuration) {
        if (!this.configuration) {
            throw Error("Not initialized");
        }
        if (!this.configuration.published) {
            throw Error("Current configuration is missing `published` property");
        }
        if (!newConfiguration.published) {
            throw Error("New configuration is missing `published` property");
        }
        if (newConfiguration.published.getTime() > this.configuration.published.getTime()) {
            this.configuration = newConfiguration;
            this.logger.debug(`Updated configuration with new configuration published at ${this.configuration.published?.toLocaleString()}`);
            this.configurationChangedCallback();
        } else {
            this.logger.debug(`Not updating configuration because the new configuration is not newer than the current configuration`);
        }
    }

    private listenForConfigurationUpdates(environmentId: string) {
        const tokenUrl = this.edgeUrl + "/realtimeToken";
        const channelName = "new-config-alert:" + environmentId;
        const realtime = new Ably.Realtime({
            authUrl:tokenUrl,
            log: {
                handler: (msg) => this.logger.debug(msg)
            }
        });
        const channel = realtime.channels.get(channelName);

        channel.subscribe(async message => {
            const configNotification = message.data as ConfigurationNotification;
            this.logger.debug("Notified of configuration change, retrieving updated configuration now");
            const newConfig = await this.loadConfiguration(appflags.ConfigurationLoadType.REALTIME_RELOAD, configNotification.published);
            this.updateConfigurationIfNewer(newConfig);
        });
    }

    private pollForConfigurationUpdates() {
        this.pollingTimer = setInterval(async () => {
            this.logger.debug("Performing periodic reload of configuration");
            const newConfig = await this.loadConfiguration(appflags.ConfigurationLoadType.PERIODIC_RELOAD);
            this.updateConfigurationIfNewer(newConfig);
        }, this.pollingPeriodMs);
        this.logger.debug(`Will poll for new configurations every ${this.pollingPeriodMs} milliseconds`);
    }

    close() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
        }
    }
}
