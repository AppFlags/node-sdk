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

    bucket(configuration: appflags.Configuration, user: appflags.User): appflags.BucketingResult  {
        if (!this.exports) {
            throw Error("Bucketing not yet initialized");
        }

        const encodedConfiguration = appflags.Configuration.encode(configuration).finish();
        const encodedUser = appflags.User.encode(user).finish();

        const encodedResult = this.exports.bucket(encodedConfiguration, encodedUser);

        return appflags.BucketingResult.decode(encodedResult);
    }
}