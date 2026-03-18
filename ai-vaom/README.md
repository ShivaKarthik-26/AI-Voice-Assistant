# AI-VAOM

AI-Driven Voice Activated Order Management demo built with React, TypeScript, and Vite.

## Easy Open

From the workspace root, you can now open the project with one double-click:

- `Open-AI-VAOM.cmd`

That launcher will:

1. Build the latest version of the app.
2. Start a local preview server at `http://127.0.0.1:4173`.
3. Open the interface in your browser automatically.

If you want to stop the local preview server later, double-click:

- `Stop-AI-VAOM.cmd`

## Manual Commands

Inside the `ai-vaom` folder:

- `npm run build`
- `npm run preview:local`

## GitHub Pages Deployment

This project is prepared for GitHub Pages deployment through GitHub Actions.

After pushing the repository to GitHub:

1. Open the repository on GitHub.
2. Go to `Settings > Pages`.
3. Set `Source` to `GitHub Actions`.
4. Push to the `main` branch.

The workflow file is:

- `.github/workflows/deploy.yml`

Because Vite is configured with a relative `base`, the static site will deploy correctly from GitHub Pages.

## Browser Note

For voice input and voice reply, use Chrome or Edge and allow microphone access.
