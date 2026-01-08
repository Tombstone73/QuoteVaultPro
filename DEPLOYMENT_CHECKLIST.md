# Deployment Checklist

- Always commit package-lock.json
- Install dependencies with `npm ci`
- Run `npm run check` before deploy
- Verify environment variables are set for target environment
- Ensure required runtime deps (e.g., archiver) are declared in package.json
- If "module not found" occurs, fix dependency declarations and reinstall
- Restart background dev servers after fresh install
- Smoke test critical flows after build
