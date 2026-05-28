# healthcare-appointments tests

## How to run
1. Deploy contract to local HotPocket node(s) so it's reachable at `wss://localhost:8081`.
2. From project root:

```bash
npm test
```

## Notes
- Tests use `hotpocket-js-client` and connect to `wss://localhost:8081`.
- They execute end-to-end flows:
  - doctor onboarding & availability
  - slot generation with buffers/exceptions
  - booking + double-booking prevention
  - cancellation/reschedule windows
  - doctor actions (cancel, complete, no-show)
  - access control checks
  - audit log presence (via admin-only query pattern in tests)
