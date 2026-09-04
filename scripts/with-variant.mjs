#!/usr/bin/env node
/**
 * Run the Expo CLI with `APP_VARIANT` set, on any platform.
 *
 *   node scripts/with-variant.mjs <variant> <expo-args...>
 *   node scripts/with-variant.mjs staging config --type public
 *
 * WHY THIS FILE EXISTS. `APP_VARIANT=staging expo config` is POSIX syntax.
 * npm runs the scripts of `package.json` through `cmd.exe` on Windows, where
 * that line is not "set a variable for one command" but a command called
 * `APP_VARIANT=staging`, and it fails before Expo starts. Development happens
 * on Windows and CI on Ubuntu, so the same script has to work in both.
 *
 * WHY NOT A DEPENDENCY. `cross-env` solves exactly this and costs a runtime
 * dependency plus its supply chain, for eleven lines. `AGENTS.md` asks for
 * explicit approval before adding one, and this is not the place to spend it.
 *
 * WHY IT SPAWNS `node` AND NOT `expo`. The binary in `node_modules/.bin` is
 * `expo.cmd` on Windows, and Node refuses to spawn a `.cmd` without a shell.
 * Resolving the CLI's JavaScript entry and running it with the current Node
 * needs no shell at all, so nothing here goes through a command-line parser.
 *
 * WHY IT DOES NOT VALIDATE THE VARIANT. `app.config.ts` is the single
 * authority on which variants exist and what an unknown one does. A second
 * list here would be a second thing to keep in sync, and the day they
 * disagreed the wrapper would be the one lying.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const [variant, ...args] = process.argv.slice(2);

if (!variant || args.length === 0) {
  console.error('usage: node scripts/with-variant.mjs <variant> <expo-args...>');
  process.exit(64);
}

const expoCli = createRequire(import.meta.url).resolve('expo/bin/cli');

const result = spawnSync(process.execPath, [expoCli, ...args], {
  stdio: 'inherit',
  env: { ...process.env, APP_VARIANT: variant },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
