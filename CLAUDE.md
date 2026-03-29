# APILens — Project Instructions

## Dev Server

**Always use this command to start the server for testing:**

```
npm run serve -- .
```

This serves the current Routeweave repo as the dataset. The server runs on **http://localhost:3789**.

> Never use `npm run serve` alone — without the path argument the server has no data and the UI shows only fallback demo APIs.

## Testing Workflow

1. Start the server with the command above before testing any UI changes.
2. Use Chrome DevTools MCP to navigate to `http://localhost:3789` and verify changes visually.
3. Test all three nav views: Explorer, Impact Analysis (select `users` table), Flows.
4. For flow overlay testing, click any API with multiple steps (e.g. `POST /api/users/registration`).
