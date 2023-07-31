import {appflags} from "@appflags/protobuf-types-typescript";
import {getPlatformData} from "./utils/platformUtil";
import fetch from 'node-fetch';
import {Logger} from "./utils/logger";
import {v4 as uuidv4} from "uuid";
import {BucketEvent} from "@appflags/protobuf-types-typescript/lib/logging";

export interface EventQueueOptions {
    queueMaxSize?: number,
    flushIntervalMs?: number,
    queueFlushSize?: number
}

const ONE_SECOND_MS = 1000;
const DEFAULT_QUEUE_MAX_SIZE = 20000;
const DEFAULT_FLUSH_INTERVAL_MS = 30 * ONE_SECOND_MS;
const DEFAULT_QUEUE_FLUSH_SIZE = 1000;

export class EventQueue {
    private readonly logger: Logger;
    private readonly edgeUrl: string;
    private readonly sdkKey: string;
    private readonly queueMaxSize: number;
    private readonly flushIntervalMs: number;
    private readonly queueFlushSize: number
    private readonly platformData: appflags.PlatformData;
    private bucketEventQueue: appflags.BucketEvent[];
    private isFlushing: boolean;
    private flushingTimer: NodeJS.Timer;

    constructor(logger: Logger, edgeUrl: string, sdkKey: string, options: EventQueueOptions) {
        this.logger = logger;
        this.edgeUrl = edgeUrl;
        this.sdkKey = sdkKey;
        this.isFlushing = false;

        this.queueMaxSize = DEFAULT_QUEUE_MAX_SIZE;
        if (options.queueMaxSize !== undefined) {
            this.queueMaxSize = Math.max(0, options.queueMaxSize);
            this.logger.info(`Event queue max size set to ${this.queueMaxSize}`);
        }

        this.flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS;
        if (options.flushIntervalMs !== undefined) {
            this.flushIntervalMs = Math.max(ONE_SECOND_MS, options.flushIntervalMs);
            this.logger.info(`Event queue flush internal set to ${this.flushIntervalMs} ms`);
        }

        this.queueFlushSize = DEFAULT_QUEUE_FLUSH_SIZE;
        if (options.queueFlushSize !== undefined) {
            this.queueFlushSize = Math.max(1, options.queueFlushSize);
            this.logger.info(`Event queue flush size set to ${this.queueFlushSize}`);
        }

        // sanity check
        if (this.queueFlushSize >= this.queueMaxSize) {
            throw Error(`Event queue flush size [${this.queueFlushSize}] must be smaller than max queue size [${this.queueMaxSize}]`);
        }

        this.platformData = getPlatformData();
        this.bucketEventQueue = [];

        this.flushingTimer = setInterval(async () => {
            this.logger.debug("Performing periodic event queue flush");
            await this.flushQueue();
        }, this.flushIntervalMs);
    }

    queueBucketEvent(userKey: string) {
        if (this.bucketEventQueue.length >= this.queueMaxSize) {
            this.logger.error("Discarding bucket event due to the event queue reaching maximum size.");
            return;
        }

        const event = appflags.BucketEvent.create();
        event.eventUuid = uuidv4();
        event.timestamp = new Date();
        event.userKey = userKey;

        this.bucketEventQueue.push(event);
        this.manageQueue();
    }

    private manageQueue() {
        if (this.bucketEventQueue.length >= this.queueFlushSize) {
            // noinspection JSIgnoredPromiseFromCall
            this.flushQueue();
        }
    }

    private async flushQueue() {
        if (this.isFlushing) {
            this.logger.debug("Event flush already in progress. Not triggering flush.")
            return;
        }
        if (this.bucketEventQueue.length === 0) {
            this.logger.debug("No events to flush. Not triggering flush.");
            return;
        }

        this.isFlushing = true;
        const eventsToFlush = [...this.bucketEventQueue];

        try {
            await this.sendEvents(eventsToFlush);
            this.bucketEventQueue = this.bucketEventQueue.slice(eventsToFlush.length);
        } catch (err) {
            this.logger.error("Error flushing events", err);
        } finally {
            this.isFlushing = false;
        }
    }

    private async sendEvents(events: BucketEvent[]) {
        const eventBatch: appflags.EventBatch = appflags.EventBatch.create();
        eventBatch.platformData = this.platformData;
        eventBatch.bucketEvents = events;
        const encodedEventBatch = Buffer.from(appflags.EventBatch.encode(eventBatch).finish()).toString("base64");

        this.logger.debug(`Sending batch of ${events.length} events`);

        const url = this.edgeUrl + "/configuration/v1/eventBatch";
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer: " + this.sdkKey
            },
            body: JSON.stringify({
                eventBatch: encodedEventBatch
            })
        });
        if (response.status === 403) {
            throw Error("Invalid SDK key");
        }
        if (response.status !== 200) {
            throw Error(`Error sending event batch, http status: ${response.status}`)
        }

        this.logger.debug(`Successfully sent batch of ${events.length} events`);
    }

    async close() {
        clearInterval(this.flushingTimer);

        // TODO: await on current flush event if happening
        this.logger.debug("Flushing remaining events");
        await this.flushQueue();
    }
}