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

/**
 * Read a file; verify it with SHA1; if mismatched, redownload from the given source
 * @param {string} filename Name of the file to read
 * @param {string} [sha1] SHA1 of the file
 * @param {string} source_url Redownload from here if file is not matched with its SHA1
 * @returns {Promise<Buffer>}
 */
async function verifiedRead(filename, sha1, source_url) {
	try {
		const data = await readFile(filename);
		if (sha1) {
			const hash = createHash("sha1").update(data).digest("hex");
			if (hash !== sha1) {
				throw new Error("hash mismatch");
			}
		}
		return data;
	} catch (error) {
		const resp = await fetch(source_url);
		const data = await resp.bytes();
		await mkdir(dirname(filename), { recursive: true });
		await writeFile(filename, data);
		console.log(filename);
		return data;
	}
}

const version_manifest_v2 = await (async () => {
	return JSON.parse(
		utf8decoder.decode(
			await verifiedRead(
				"minecraft/versions/version_manifest_v2.json",
				undefined,
				"https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
			)
		)
	);
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
	return JSON.parse(
		utf8decoder.decode(
			await verifiedRead(
				`minecraft/versions/${ver2dl.id}/${ver2dl.id}.json`,
				ver2dl.sha1,
				ver2dl.url
			)
		)
	);
})();

const assetIndex = await (async () => {
	return JSON.parse(
		utf8decoder.decode(
			await verifiedRead(
				`minecraft/assets/indexes/${version.assetIndex.id}.json`,
				version.assetIndex.sha1,
				version.assetIndex.url
			)
		)
	);
})();

await mkdir("minecraft/assets/objects", { recursive: true });
for (const { hash } of Object.values(assetIndex.objects)) {
	await verifiedRead(
		`minecraft/assets/objects/${hash.substring(0, 2)}/${hash}`,
		hash,
		`https://resources.download.minecraft.net/${hash.substring(0, 2)}/${hash}`
	);
}

await verifiedRead(
	`minecraft/assets/log_configs/${version.logging.client.file.id}`,
	version.logging.client.file.sha1,
	version.logging.client.file.url
);

await verifiedRead(
	`minecraft/versions/${version.id}/${version.id}.jar`,
	version.downloads.client.sha1,
	version.downloads.client.url
);

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
	natives_directory: `versions/${version.id}/natives`,
	...jvm_config,
	classpath: `${cp.join(platform() === "win32" ? ";" : ":")}`
});

const logging_args = runInNewContext(`\`${version.logging.client.argument}\``, {
	path: `assets/log_configs/${version.logging.client.file.id}`
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
