# Agents test coverage (Node test runner)

This repo uses Node’s built-in test runner coverage gates via `npm run test:agents`:

- lines: `>= 90%`
- functions: `>= 90%`
- branches: `>= 85%`
- include: `js/agents/**/*.js`

Run:

```bash
npm run test:agents
```

The command exits `0` when all coverage thresholds are met.

