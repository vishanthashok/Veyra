# Veyra brand validation

## Completed

- Generated outlined SVG masters and all nine requested filenames in `frontend/public/brand/`.
- Exported transparent light, dark, and monochrome lockups at 1800 × 598 pixels directly from SVG with Sharp 0.35.5.
- Verified exact decoded-pixel equality between each lockup PNG and a fresh render of its SVG, including transparent canvas corners.
- Verified square PNG dimensions at 16, 24, 32, 64, 128, 180, 192, 256, 512, and 1024px.
- Decoded and checked all six ICO frames (16/32/48/64/128/256px); the Next.js file-based favicon matches the public brand ICO byte for byte.
- Checked manifest icon references against the generated files.
- Opened the primary PNG, 512px icon, and contact sheet for visual inspection. The sheet shows every variation, including transparency, and native-size icon proofs on light and charcoal backgrounds. Revised the initial plain V to add a recessed joint and optically centered the app monogram before final export.
- Integrated one shared `BrandLogo` component into the sidebar, mobile navigation, and login page; configured favicon, Apple icon, application name, title, description, and web manifest.
- Added an accessible sidebar collapse control. Main links, property links, and sign-out remain available with accessible labels while collapsed.
- Added automatic light/dark branding and surface colors; explicit root `data-theme` values and the `dark` class are supported. The sidebar retains its charcoal surface in both modes.

## Reproducible asset check

From `frontend/`, run `node scripts/brand/verify.cjs` with Sharp installed. Rebuild commands, asset usage, and font licensing are documented in `public/brand/README.md`.

## Runtime validation limit

The frontend dependencies were unavailable locally. A frozen pnpm install failed because the environment denied registry.npmjs.org with HTTP 403; the offline attempt had no cached package metadata. No dependency lockfile was changed. A Next.js build, TypeScript/lint run, and live browser interaction checks could therefore not be completed here. The exported artwork was visually inspected, but live sidebar/login theme rendering and collapse behavior still require review in a configured development environment.

Before merging, run `pnpm install --frozen-lockfile`, `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm build`. Then visit `/login` and the authenticated dashboard in light and dark OS preferences, test expanded/collapsed navigation, and check the browser favicon. Existing authentication and API calls remain intact; no backend files or financial calculations are changed.
