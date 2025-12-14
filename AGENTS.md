# Repository Guidelines

## Project Structure & Module Organization
- Source pages live in `_posts/` (published) and `_drafts/` (work-in-progress). Each file uses YAML front matter for title, date, tags, and layout.
- Shared templates are in `_layouts/` and `_includes/`; SCSS partials sit in `_sass/`. Static assets (images, fonts, JS/CSS) are under `assets/`.
- `_site/` is the generated output; never edit or commit manual changes there.
- Site-wide settings and metadata are in `_config.yml`; data-driven bits belong in `_data/`.

## Build, Test, and Development Commands
- Install dependencies:  
  ```bash
  bundle install
  ```
- Run locally with live reload:  
  ```bash
  bundle exec jekyll serve --livereload
  ```
- Production build (used by GitHub Pages/CI):  
  ```bash
  bundle exec jekyll build
  ```
- Preview drafts locally: add `--drafts --future` to `jekyll serve` when checking unpublished posts.

## Coding Style & Naming Conventions
- Markdown content: wrap lines at logical breaks; use fenced code blocks with language tags; prefer descriptive file names like `2024-03-18-title.md`.
- Front matter: keep keys lowercase and consistent (`layout`, `title`, `date`, `tags`). Dates use ISO format.
- Liquid templates: 2-space indentation; avoid trailing whitespace; keep filters explicit (`| escape`, `| date: "%Y-%m-%d"`).
- SCSS: group variables/mixins near the top of partials; rely on shared partials in `_sass/` rather than inline styles.

## Testing & Quality Checks
- There is no automated test suite; rely on local `jekyll serve` for visual and console warnings. Fix build warnings before opening a PR.
- Verify links and assets load locally; check mobile and desktop breakpoints if you touch layout or SCSS.
- For posts, proofread titles, summaries, and metadata; ensure images exist under `assets/` with correct paths.

## Commit & Pull Request Guidelines
- Commit messages follow the short, imperative style seen in history (e.g., `Refine style`, `Update config`); keep scope small.
- Each PR should describe the change, why it’s needed, and how to verify (include commands and relevant screenshots for layout changes).
- Link issues when applicable; call out breaking or visual changes explicitly.

## Configuration & Troubleshooting
- When adjusting `_config.yml`, note that GitHub Pages may cache settings—force a rebuild by re-running the build locally to confirm.
- If the site fails to build, run `bundle update` cautiously, then retest `jekyll build`; pin new versions in `Gemfile` as needed.
