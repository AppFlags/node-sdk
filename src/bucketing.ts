import {appflags} from "@appflags/protobuf-types-typescript";
import {readFileSync} from "fs";

const wasmPath = require.resolve("@appflags/bucketing-assemblyscript/build/release.wasm");

export class Bucketing {
    private exports: any|null;
    constructor() {
        this.exports = null;
    }

    async instantiate(): Promise<void> {
        const {instantiate} = await import("@appflags/bucketing-assemblyscript");
        const file = readFileSync(wasmPath);
        const module = await WebAssembly.compile(file)
        this.exports = await instantiate(module, {env: {}});
    }

    setConfiguration(configuration: appflags.Configuration) {
        const encodedConfiguration = appflags.Configuration.encode(configuration).finish();
        this.exports.setConfiguration(encodedConfiguration);
    }

    bucket(user: appflags.User): appflags.BucketingResult  {
        if (!this.exports) {
            throw Error("Bucketing not yet initialized");
        }
        const encodedUser = appflags.User.encode(user).finish();

        const encodedResult = this.exports.bucket(encodedUser);

        return appflags.BucketingResult.decode(encodedResult);
    }

    bucketOneFlag(user: appflags.User, flagKey: string): appflags.BucketingResult  {
        if (!this.exports) {
            throw Error("Bucketing not yet initialized");
        }
        const encodedUser = appflags.User.encode(user).finish();

        const encodedResult = this.exports.bucketOneFlag(encodedUser, flagKey);

        return appflags.BucketingResult.decode(encodedResult);
    }
}