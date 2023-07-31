import {appflags} from "@appflags/protobuf-types-typescript";
const pkg = require("../../package.json");

export const getPlatformData = (): appflags.PlatformData => {
    const platformData = appflags.PlatformData.create();
    platformData.sdk = 'Node';
    platformData.sdkType = 'server';
    platformData.sdkVersion = pkg.version;
    platformData.platform = 'Node';
    platformData.platformVersion = process.version;
    return platformData;
}