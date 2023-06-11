import {User} from "@appflags/types-typescript";


async function doThing() {
    const {add, bucket} = await import("@appflags/bucketing-assemblyscript");
    console.log("add results is ", add(2,3));

    const user = User.create({key: "user_key"})
    const encoded = User.encode(user).finish()

    bucket(encoded);
}

doThing();
