# Repository Guidelines

## Project Structure & Module Organization

The Bun/TypeScript server starts in `src/index.ts`. HTTP handlers live in `src/routes/`, shared state and serving logic in `src/core/`, and configuration/types in `src/config.ts` and `src/types.ts`. OS-specific behavior belongs under `src/providers/<os>/`; keep profile definitions in each provider's `profiles/` directory. Dashboard rendering is in `src/ui/`, with browser assets in `public/`. Tests are top-level `tests/*.test.ts`. Configuration samples live in `config/`, documentation in `docs/`, and Proxmox helpers in `proxmox/`.

## Build, Test, and Development Commands

- `bun install` installs dependencies (Bun 1.2+ is expected).
- `bun run dev` starts the service with file watching; `bun start` runs it once.
- `bun test` runs the complete Bun test suite with an ephemeral server port.
- `bun test tests/server.test.ts` runs one test file while iterating.
- `bun run build` produces a minified standalone binary in `dist/`; `bun run build:all` cross-compiles all release targets.
- `bun run sync-assets` mirrors required boot assets locally.
- `bun run docs:dev` previews VitePress docs; `bun run docs:build` verifies the production documentation build.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, semicolons, double-quoted strings, and explicit types at module boundaries. The project uses strict TypeScript, ES modules, and `.ts` import suffixes. Use `camelCase` for variables/functions, `PascalCase` for classes and types, and kebab-case filenames such as `static-server.ts`. Keep route handlers thin and place OS-specific generation logic in the relevant provider. No formatter or linter is configured, so match nearby code and keep diffs focused.

## Testing Guidelines

Use `bun:test` and name files `*.test.ts`. Group behavior with `describe`, write outcome-focused `it` descriptions, and clean up temporary state in `afterAll`. Add coverage for new routes, configuration fallbacks, generated iPXE/config output, and installation-state transitions. Run `bun test` before every pull request; also run `bun run docs:build` when changing documentation.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits, for example `feat: add standalone binary compilation support`, `fix(ci): restore example config`, and `docs: streamline README`. Use `type(scope): imperative summary` where a scope adds clarity. Pull requests should explain the motivation and behavior change, list validation commands, link relevant issues, and include screenshots for dashboard changes. Call out configuration or provisioning compatibility impacts.

## Security & Configuration

Never commit `.env`, `proxmox/credentials.env`, kubeconfigs, `config/hosts.yaml`, runtime databases, logs, or downloaded `assets/`. Extend sanitized examples under `config/examples/` when introducing configuration keys.
