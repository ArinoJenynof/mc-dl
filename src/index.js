import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from 'node:process';
import { platform, release } from "node:os";
import { dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import jvm_config from "../config/jvm.json" with { type: "json" };
import game_config from "../config/game.json" with { type: "json" };

const utf8decoder = new TextDecoder();

const version_manifest_v2 = await (async () => {
	const data = await (async () => {
		try {
			return await readFile("minecraft/versions/version_manifest_v2.json", { encoding: "utf-8" });
		} catch (error) {
			const resp = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
			const data = await resp.bytes();

			await mkdir("minecraft/versions", { recursive: true });
			await writeFile("minecraft/versions/version_manifest_v2.json", data);
			return utf8decoder.decode(data);
		}
	})();
	return JSON.parse(data);
})();

const ver2dl = await (async () => {
	const rl = createInterface({ input, output });

	let ver;
	do {
		let ans = await rl.question("Type version to download: ");

		if (ans === "release") {
			ans = version_manifest_v2.latest.release;
		} else if (ans === "snapshot") {
			ans = version_manifest_v2.latest.snapshot;
		}

		ver = version_manifest_v2.versions.find(e => e.id === ans);
	} while (ver === undefined);
	rl.close();

	return ver;
})();

const version = await (async () => {
	const data = await (async () => {
		try {
			return await readFile(`minecraft/versions/${ver2dl.id}/${ver2dl.id}.json`, { encoding: "utf-8" });
		} catch (error) {
			const resp = await fetch(ver2dl.url);
			const data = await resp.bytes();

			await mkdir(`minecraft/versions/${ver2dl.id}`, { recursive: true });
			await writeFile(`minecraft/versions/${ver2dl.id}/${ver2dl.id}.json`, data);
			return utf8decoder.decode(data);
		}
	})();
	return JSON.parse(data);
})();

const assetIndex = await (async () => {
	const data = await (async () => {
		try {
			return await readFile(`minecraft/assets/indexes/${version.assetIndex.id}.json`, { encoding: "utf-8" });
		} catch (error) {
			const resp = await fetch(version.assetIndex.url);
			const data = await resp.bytes();

			await mkdir("minecraft/assets/indexes", { recursive: true });
			await writeFile(`minecraft/assets/indexes/${version.assetIndex.id}.json`, data);
			return utf8decoder.decode(data);
		}
	})();
	return JSON.parse(data);
})();

await mkdir("minecraft/assets/objects", { recursive: true });
for (const [assetName, { hash }] of Object.entries(assetIndex.objects)) {
	try {
		await access(`minecraft/assets/objects/${hash.substring(0, 2)}/${hash}`);
	} catch (error) {
		const resp = await fetch(`https://resources.download.minecraft.net/${hash.substring(0, 2)}/${hash}`);
		const data = await resp.bytes();

		await mkdir(`minecraft/assets/objects/${hash.substring(0, 2)}`, { recursive: true });
		await writeFile(`minecraft/assets/objects/${hash.substring(0, 2)}/${hash}`, data);
		console.log(assetName);
	}
}

try {
	await access(`minecraft/assets/log_configs/${version.logging.client.file.id}`);
} catch (error) {
	const resp = await fetch(version.logging.client.file.url);
	const data = await resp.bytes();

	await mkdir("minecraft/assets/log_configs", { recursive: true });
	await writeFile(`minecraft/assets/log_configs/${version.logging.client.file.id}`, data);
}

try {
	await access(`minecraft/versions/${version.id}/${version.id}.jar`);
} catch (error) {
	const resp = await fetch(version.downloads.client.url);
	const data = await resp.bytes();

	await writeFile(`minecraft/versions/${version.id}/${version.id}.jar`, data);
}

const plat = (() => {
	switch (platform()) {
		case "win32":
			return "windows"
		case "darwin":
			return "osx"
		default:
			return platform();
	}
})();

const cp = [];
for (const lib of version.libraries) {
	if (lib.rules) {
		const rule = lib.rules.find(e => e.os.name === plat);
		if (rule === undefined) {
			continue;
		}

		if (rule.action !== "allow") {
			continue;
		}
	}

	try {
		await access(`minecraft/libraries/${lib.downloads.artifact.path}`);
	} catch (error) {
		const resp = await fetch(lib.downloads.artifact.url);
		const data = await resp.bytes();

		await mkdir(dirname(`minecraft/libraries/${lib.downloads.artifact.path}`), { recursive: true });
		await writeFile(`minecraft/libraries/${lib.downloads.artifact.path}`, data);
		console.log(lib.downloads.artifact.path);
	}
	cp.push(`libraries/${lib.downloads.artifact.path}`);
}
cp.push(`versions/${version.id}/${version.id}.jar`);

const default_user_jvm = [];
for (const args of version.arguments["default-user-jvm"]) {
	if (args.rules) {
		const rule = args.rules.find(e => e.os.name === plat);
		if (rule === undefined) {
			continue;
		}

		if (rule.action !== "allow") {
			continue;
		}

		if (rule.os.name === "windows") {
			if (rule.os.versionRange.max && rule.os.versionRange.max < release()) {
				continue;
			} else if (rule.os.versionRange.min && rule.os.versionRange.min > release()) {
				continue;
			}
		}
	}
	
	default_user_jvm.push(...args.value);
}

const jvm = [];
for (const args of version.arguments.jvm) {
	if (args.rules) {
		const rule = args.rules.find(e => e.os.name === plat);
		if (rule === undefined) {
			continue;
		}

		if (rule.action !== "allow") {
			continue;
		}
	}

	if (typeof args === "object") {
		if (typeof args.value === "string") {
			jvm.push(args.value);
		} else {
			jvm.push(...args.value);
		}
	} else {
		jvm.push(args);
	}
}

const game = [];
for (const args of version.arguments.game) {
	if (args.rules) {
		const rule = args.rules.find(e => e.features.has_custom_resolution);
		if (rule === undefined) {
			continue;
		}
		game.push(...args.value);
	} else {
		game.push(args);
	}
}

const jvm_args = runInNewContext(`\`${jvm.join(" ")}\``, {
	natives_directory: `"versions/${version.id}/natives"`,
	...jvm_config,
	classpath: `"${cp.join(platform() === "win32" ? ";" : ":")}"`
});

const logging_args = runInNewContext(`\`${version.logging.client.argument}\``, {
	path: `"assets/log_configs/${version.logging.client.file.id}"`
});

const game_args = runInNewContext(`\`${game.join(" ")}\``, {
	...game_config,
	version_name: version.id,
	game_directory: ".",
	assets_root: "assets",
	assets_index_name: version.assetIndex.id,
	auth_uuid: (auth_player_name => {
		// Stolen from https://stackoverflow.com/a/65404637
		let md5Bytes = createHash('md5').update(auth_player_name).digest();
		md5Bytes[6]  &= 0x0f;  /* clear version        */
		md5Bytes[6]  |= 0x30;  /* set to version 3     */
		md5Bytes[8]  &= 0x3f;  /* clear variant        */
		md5Bytes[8]  |= 0x80;  /* set to IETF variant  */
		const hex = md5Bytes.toString('hex')
		const uuid = hex.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, "$1-$2-$3-$4-$5");
		return uuid;
	})(`OfflinePlayer:${game_config.auth_player_name}`),
	auth_access_token: "420",
	clientid: "69",
	auth_xuid: "67",
	version_type: version.type,
});

const args = `@javaw ${default_user_jvm.join(" ")} ${jvm_args} ${logging_args} ${version.mainClass} ${game_args}`;
await writeFile(`minecraft/${version.id}.${platform() === "win32" ? "cmd" : "sh"}`, args);
