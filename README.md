# Break & Run — Multiplayer 8-Ball Pool

A complete, browser-based 8-ball pool game with real-time multiplayer. Play a random opponent from the matchmaking queue, or create a private room and invite a friend with a 5-character code. No build step, no accounts, no client dependencies — just Node and a browser.

## Version History

### v1.0.0 (2026-10-30)
- Initial release
- Random matchmaking queue
- Private rooms with 5-character codes + invite links
- Server-authoritative deterministic physics (fixed 1/480 s step)
- Full 8-ball rules: open table after break, group assignment, fouls → ball in hand, 8-ball win/loss, 8-on-break re-spot
- Rematch support
- Canvas 2D renderer: wooden rails, felt, pocket liners, ball shading, cue, aim guide, ghost ball
- Procedural WebAudio sound effects
- Responsive layout (desktop → mobile)
- WebSocket reconnection, connection warning, clean disconnect handling
- Test suite: rules engine unit tests, two-bot WebSocket soak test, Playwright e2e test