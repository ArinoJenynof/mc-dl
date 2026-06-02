# Minecraft Downloader
Download Minecraft files straight from Mojang.

### Why?
Too many launcher forks whilst I just wanted the game files. I like them clean.

# Prerequisites
1. Brain
2. NodeJS
3. Java if you want to run the game

# Usage
Copy/Rename `config/{game,jvm}.example.json` to `config/{game,jvm}.json` (Remove `.example` basically). App won't run if you don't.

And then simply just

```cmd
cd <folder where you clone/download/install this app>
node .
```

You will be asked which Minecraft version you want to download. Should be the same as in official launcher, so type something like `26.1.2` or `1.21.10` or `25w43a`. If you don't care type `release` for latest stable version or `snapshot` for... you get the idea. If in doubt check `minecraft/versions/version_manifest_v2.json` as that file is the source of every versions downloadable from Mojang.

Downloaded files are put inside `minecraft/` folder. There is also a simple launcher script named `<version>.{cmd,sh}` so you can launch an offline profile to check things out. Feel free to move `minecraft/` folder to anywhere you want as I set the path relative to launcher script, so unless you put it in strange places it should work portably.

# Configuration
Check `config/` folder. If any string value in there have space, remember to insert escaped double quotes. This is because I'm a lazy bum. And for any JVM arguments (things like `-Xmx` or `-Xms`) just change it on the generated launcher script. See the previous sentence for why.

If you change things on `config/` re-run the app to insert the new values.

# Acknowledgements
1. Minecraft portable maker from *that* steam underground forum. In fact I started this because I want to understand ~~the enemy~~ how that script works. It's written in Lua, so I rewrote it in Javascript for, argument reasons (See line 213 and `arguments` object in `<version>.json`)
2. Java `UUID.nameUUIDFromBytes`, which is used by Minecraft to generate offline player UUID, is "stolen" from [this stackoverflow answer](https://stackoverflow.com/a/65404637)

# Random Thoughts for the Future That May Not Come
1. Everything is hardcoded, would be nice if output folder, download folder, can be configured somehow
2. Configuration value is currently handwritten. If only I could make sense of `arguments` object in `<version>.json` I could generate things automatically. It seems like there is no pattern there, it's much work to generate so I rather just copy and write things myself.
3. Files are currently only tested if they are exist, should be hash-checked.
3. Non-Windows are untested. I use Windows and I have no reason to use any other OSes.
